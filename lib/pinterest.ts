/**
 * Client for Pinterest's internal web API (the same /resource/… endpoints pinterest.com
 * itself calls). Runs in the content script, so requests are same-origin and carry the
 * user's own login. These endpoints are undocumented and can change without notice;
 * every response is parsed defensively.
 */
import { sleep } from './pool';

export class PinterestApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export type Board = { id: string; name: string; url: string; pinCount?: number; sectionCount?: number };
export type Section = { id: string; title: string; slug: string; pinCount?: number };

type Page = { items: any[]; bookmark?: string };

function isEnd(bookmark: string | undefined): boolean {
  // "Y2JOb25lO" is base64 for "cbNone;", Pinterest's other end-of-feed marker.
  return !bookmark || bookmark === '-end-' || bookmark.startsWith('Y2JOb25lO');
}

export async function resource(name: string, options: Record<string, unknown>, sourceUrl: string): Promise<{ data: any; bookmark?: string }> {
  const params = new URLSearchParams({
    source_url: sourceUrl,
    data: JSON.stringify({ options, context: {} }),
    _: String(Date.now()),
  });
  const url = `${location.origin}/resource/${name}/get/?${params}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Pinterest-AppState': 'active',
          'X-Pinterest-Source-Url': sourceUrl,
        },
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new PinterestApiError(`Pinterest answered ${res.status}`, res.status);
        await sleep(800 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new PinterestApiError(`Pinterest answered ${res.status} for ${name}`, res.status);
      const json = await res.json();
      const rr = json?.resource_response ?? {};
      if (rr.error) throw new PinterestApiError(rr.error?.message ?? `Pinterest returned an error for ${name}`, rr.status_code);
      const bookmark: string | undefined = rr.bookmark ?? json?.resource?.options?.bookmarks?.[0];
      return { data: rr.data, bookmark };
    } catch (e) {
      lastErr = e;
      if (e instanceof PinterestApiError && e.status && e.status < 500 && e.status !== 429) throw e;
      await sleep(600 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new PinterestApiError(`Could not reach Pinterest (${name})`);
}

/** Walk every page of a feed. Each yielded batch is one page of raw items. */
export async function* paginate(
  name: string,
  options: Record<string, unknown>,
  sourceUrl: string,
  pageSize = 25,
): AsyncGenerator<any[]> {
  let bookmark: string | undefined;
  for (let page = 0; page < 2000; page++) {
    const opts = { ...options, page_size: pageSize, ...(bookmark ? { bookmarks: [bookmark] } : {}) };
    const { data, bookmark: next } = await resource(name, opts, sourceUrl);
    const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
    yield items;
    if (isEnd(next) || next === bookmark || items.length === 0) return;
    bookmark = next;
    await sleep(250);
  }
}

const boardCache = new Map<string, Promise<Board>>();
const sectionCache = new Map<string, Promise<Section[]>>();

export function getBoard(username: string, slug: string, boardPath: string): Promise<Board> {
  const key = boardPath.toLowerCase();
  let p = boardCache.get(key);
  if (!p) {
    p = resource('BoardResource', { username, slug, field_set_key: 'detailed' }, boardPath).then(({ data }) => {
      if (!data?.id) throw new PinterestApiError('Board not found');
      return {
        id: String(data.id),
        name: String(data.name ?? slug),
        url: String(data.url ?? boardPath),
        pinCount: num(data.pin_count),
        sectionCount: num(data.section_count),
      };
    });
    p.catch(() => boardCache.delete(key));
    boardCache.set(key, p);
  }
  return p;
}

export function getSections(boardId: string, boardPath: string): Promise<Section[]> {
  let p = sectionCache.get(boardId);
  if (!p) {
    p = (async () => {
      const out: Section[] = [];
      for await (const items of paginate('BoardSectionsResource', { board_id: boardId }, boardPath)) {
        for (const s of items) {
          if (!s?.id) continue;
          out.push({ id: String(s.id), title: String(s.title ?? s.slug ?? 'Section'), slug: String(s.slug ?? ''), pinCount: num(s.pin_count) });
        }
      }
      return out;
    })();
    p.catch(() => sectionCache.delete(boardId));
    sectionCache.set(boardId, p);
  }
  return p;
}

/** Pins on a board. With `excludeSectionPins`, only pins that are not in any section. */
export function boardPins(boardId: string, boardPath: string, excludeSectionPins: boolean) {
  return paginate(
    'BoardFeedResource',
    {
      board_id: boardId,
      board_url: boardPath,
      field_set_key: 'react_grid_pin',
      filter_section_pins: excludeSectionPins,
      layout: 'default',
      prepend: false,
    },
    boardPath,
  );
}

export function sectionPins(sectionId: string, sectionPath: string) {
  return paginate('BoardSectionPinsResource', { section_id: sectionId, field_set_key: 'react_grid_pin' }, sectionPath);
}

export function userPins(username: string, tab: string) {
  const path = `/${encodeURIComponent(username)}/${tab === 'created' ? '_created' : 'pins'}/`;
  if (tab === 'created') {
    return paginate('UserActivityPinsResource', { username, field_set_key: 'grid_item', exclude_add_pin_rep: true }, path);
  }
  return paginate('UserPinsResource', { username, field_set_key: 'grid_item' }, path);
}

export function searchPins(query: string) {
  const path = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
  return paginate('BaseSearchResource', { query, scope: 'pins', rs: 'typed', redux_normalize_feed: true, source_url: path }, path);
}

export async function getPin(id: string): Promise<any> {
  const { data } = await resource('PinResource', { id, field_set_key: 'detailed' }, `/pin/${id}/`);
  if (!data?.id) throw new PinterestApiError('Pin not found');
  return data;
}

export async function getUserPinCount(username: string): Promise<number | undefined> {
  try {
    const { data } = await resource('UserResource', { username, field_set_key: 'profile' }, `/${encodeURIComponent(username)}/`);
    return num(data?.pin_count);
  } catch {
    return undefined;
  }
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
