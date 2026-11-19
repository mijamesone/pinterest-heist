/** Turn the selection into a full list of pins, fetching boards, sections and pin details. */
import * as api from '../lib/pinterest';
import { isPinItem, parsePin, pinFromThumb, type PinInfo } from '../lib/pins';
import type { Entry } from '../lib/plan';
import { pool } from '../lib/pool';
import type { Selection } from './selection';

export const UNSORTED = '__unsorted';

export type CollectOptions = {
  /** Board-wide downloads: section IDs to include, plus UNSORTED. null means everything. */
  includeSections: Set<string> | null;
  signal: AbortSignal;
  onProgress: (found: number) => void;
};

function sameSlug(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      return decodeURIComponent(s).toLowerCase();
    } catch {
      return s.toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

export async function collectEntries(sel: Selection, opts: CollectOptions): Promise<Entry[]> {
  const entries: Entry[] = [];
  const have = new Set<string>();
  const { signal } = opts;
  const abortCheck = () => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  };

  const push = (pin: PinInfo, folder: string, board?: string, section?: string) => {
    if (!pin.id) return;
    if (sel.all && sel.excluded.has(pin.id)) return;
    const key = `${folder}|${pin.id}`;
    if (have.has(key)) return;
    have.add(key);
    entries.push({ pin, folder, board, section });
    opts.onProgress(entries.length);
  };
  const pushRaw = (items: any[], folder: string, board?: string, section?: string) => {
    for (const raw of items) if (isPinItem(raw)) push(parsePin(raw), folder, board, section);
  };

  const all = sel.all;
  if (all) {
    const ctx = all.ctx;
    if (ctx.kind === 'board') {
      const board = await api.getBoard(ctx.username, ctx.slug, ctx.path);
      const include = opts.includeSections;
      if (!include || include.has(UNSORTED)) {
        for await (const items of api.boardPins(board.id, ctx.path, true)) {
          abortCheck();
          pushRaw(items, '', board.name, '');
        }
      }
      const sections = board.sectionCount === 0 ? [] : await api.getSections(board.id, ctx.path);
      for (const s of sections) {
        if (include && !include.has(s.id)) continue;
        if (!include && sel.excludedSections.has(s.slug)) continue;
        for await (const items of api.sectionPins(s.id, `${ctx.path}${encodeURIComponent(s.slug)}/`)) {
          abortCheck();
          pushRaw(items, s.title, board.name, s.title);
        }
      }
    } else if (ctx.kind === 'section') {
      const board = await api.getBoard(ctx.username, ctx.boardSlug, ctx.boardPath);
      const sections = await api.getSections(board.id, ctx.boardPath);
      const s = sections.find((x) => sameSlug(x.slug, ctx.sectionSlug));
      if (!s) throw new Error('Pinterest Heist could not find this section. Reload the page and try again.');
      for await (const items of api.sectionPins(s.id, ctx.path)) {
        abortCheck();
        pushRaw(items, '', board.name, s.title);
      }
    } else if (ctx.kind === 'profile') {
      for await (const items of api.userPins(ctx.username, ctx.tab)) {
        abortCheck();
        pushRaw(items, '', undefined, '');
      }
    } else if (ctx.kind === 'search') {
      const limit = all.limit ?? 200;
      let n = 0;
      outer: for await (const items of api.searchPins(ctx.query)) {
        abortCheck();
        for (const raw of items) {
          if (!isPinItem(raw)) continue;
          if (n >= limit) break outer;
          push(parsePin(raw), '', undefined, '');
          n++;
        }
        if (n >= limit) break;
      }
    }
  }

  // Whole sections picked on a board page (without select-all).
  if (!all && sel.sections.size) {
    for (const ref of sel.sections.values()) {
      abortCheck();
      const board = await api.getBoard(ref.username, ref.boardSlug, ref.boardPath);
      const sections = await api.getSections(board.id, ref.boardPath);
      const s = sections.find((x) => sameSlug(x.slug, ref.slug));
      if (!s) continue;
      for await (const items of api.sectionPins(s.id, `${ref.boardPath}${encodeURIComponent(s.slug)}/`)) {
        abortCheck();
        pushRaw(items, s.title, board.name, s.title);
      }
    }
  }

  // Pins picked one by one. Full details give the original file, title and carousel images.
  const singles = [...sel.pins.values()].filter((p) => !entries.some((e) => e.pin.id === p.id));
  await pool(
    singles,
    4,
    async (p) => {
      let pin: PinInfo;
      try {
        pin = parsePin(await api.getPin(p.id));
        if (!pin.media.length) throw new Error('no media');
      } catch {
        pin = pinFromThumb(p.id, p.thumb, p.title);
      }
      push(pin, '', pin.board ?? p.board, p.section ?? '');
    },
    signal,
  );
  abortCheck();

  // Feed items that were too thin (Idea Pins without pages).
  const thin = entries.filter((e) => e.pin.needsDetail || !e.pin.media.length);
  await pool(
    thin,
    4,
    async (e) => {
      try {
        const full = parsePin(await api.getPin(e.pin.id));
        if (full.media.length) e.pin = { ...full, board: full.board ?? e.pin.board };
      } catch {
        /* keep what we have; the plan will list it as skipped */
      }
    },
    signal,
  );
  abortCheck();
  return entries;
}
