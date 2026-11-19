/** What kind of Pinterest page the user is on, parsed from the URL. */
export type PageContext =
  | { kind: 'pin'; pinId: string }
  | { kind: 'board'; username: string; slug: string; path: string }
  | { kind: 'section'; username: string; boardSlug: string; sectionSlug: string; path: string; boardPath: string }
  | { kind: 'profile'; username: string; tab: string; path: string }
  | { kind: 'search'; query: string; path: string }
  | { kind: 'home' }
  | { kind: 'other'; path: string };

// First path segments that are Pinterest features, never usernames.
const RESERVED_ROOT = new Set([
  'pin', 'search', 'ideas', 'today', 'settings', 'business', 'explore', 'homefeed', 'news_hub', 'videos',
  'shopping', 'notifications', 'messages', 'login', 'signup', 'password', 'resource', 'about', 'categories',
  'topics', 'board', 'secret', 'edit', 'discover', 'creator-hub', 'inbox', 'analytics', 'ads', 'tv',
  'following', 'offsite', 'oauth', 'logout', 'reset', 'invite', 'help', 'privacy', 'terms', 'developers',
  'apps', 'idea-pin-builder', 'pin-builder', 'pin-creation-tool', 'convert', 'shop',
]);

// Second segments on a profile that are tabs, never board slugs.
const PROFILE_TABS = new Set([
  'pins', 'followers', 'following', 'boards', 'saved', 'created', 'tried', 'community', 'shop',
]);

// Third segments on a board that are board sub-pages, never section slugs.
const BOARD_SUBPAGES = new Set(['more_ideas', 'more-ideas', 'organize', 'organise', 'activity', 'collaborators']);

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseContext(pathname: string, search = ''): PageContext {
  const raw = pathname.split('/').filter(Boolean);
  const segs = raw.map(decode);
  if (segs.length === 0) return { kind: 'home' };
  const [a, b, c] = segs;

  if (a === 'pin' && b) return { kind: 'pin', pinId: b };
  if (a === 'search') {
    const query = new URLSearchParams(search).get('q') ?? '';
    return { kind: 'search', query, path: pathname };
  }
  if (a === 'homefeed') return { kind: 'home' };
  if (RESERVED_ROOT.has(a) || a.startsWith('_')) return { kind: 'other', path: pathname };

  if (!b) return { kind: 'profile', username: a, tab: 'root', path: `/${raw[0]}/` };
  if (b.startsWith('_') || PROFILE_TABS.has(b)) {
    return { kind: 'profile', username: a, tab: b.replace(/^_/, ''), path: `/${raw[0]}/${raw[1]}/` };
  }

  const boardPath = `/${raw[0]}/${raw[1]}/`;
  if (!c || c.startsWith('_') || BOARD_SUBPAGES.has(c)) {
    return { kind: 'board', username: a, slug: b, path: boardPath };
  }
  return {
    kind: 'section',
    username: a,
    boardSlug: b,
    sectionSlug: c,
    path: `${boardPath}${raw[2]}/`,
    boardPath,
  };
}

/** Pages where "select all" has a real end and can be fetched completely. */
export function supportsSelectAll(ctx: PageContext): boolean {
  if (ctx.kind === 'board' || ctx.kind === 'section' || ctx.kind === 'search') return true;
  if (ctx.kind === 'profile') return ctx.tab === 'pins' || ctx.tab === 'created';
  return false;
}

/** "my-cool-board" → "My Cool Board". Used until the real board name has loaded. */
export function humanizeSlug(slug: string): string {
  return decode(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (_, sp: string, ch: string) => sp + ch.toUpperCase());
}

export function sameContext(a: PageContext, b: PageContext): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
