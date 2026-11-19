/** File and folder naming that is always safe on Windows. */

// Characters Windows does not allow in file names, plus control characters.
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
// Names Windows reserves for devices, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

export const TOKENS = ['board', 'section', 'index', 'pinId', 'title', 'pinner', 'date', 'query'] as const;
export type Token = (typeof TOKENS)[number];
export type TokenValues = Partial<Record<Token, string | undefined>>;

export const DEFAULT_PATTERN = '{board}_{section}_{index}';

export function sanitizeSegment(input: string | undefined | null, max = 80): string {
  let s = String(input ?? '')
    .normalize('NFC')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[. ]+/, '').replace(/[. ]+$/, '');
  if (s.length > max) s = s.slice(0, max).replace(/[. ]+$/, '');
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/**
 * Fill a pattern such as "{board}_{section}_{index}". Separators left dangling by empty
 * tokens are collapsed, so an empty {section} gives "Board_001" instead of "Board__001".
 */
export function renderPattern(pattern: string, values: TokenValues): string {
  let out = pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key as Token];
    if (v == null) return '';
    return sanitizeSegment(v, key === 'title' ? 60 : 80);
  });
  out = out.replace(ILLEGAL, ' ');
  out = out.replace(/(\s*[-_.]\s*)(?:\s*[-_.]\s*)+/g, '$1');
  out = out.replace(/^[\s\-_.]+|[\s\-_.]+$/g, '');
  return sanitizeSegment(out, 120);
}

export function padIndex(i: number, total: number): string {
  return String(i).padStart(Math.max(3, String(total).length), '0');
}

/** a, b, … z, aa, ab … for multi-image pins. */
export function subLetter(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function extFromUrl(url: string): string {
  const m = /\.(jpe?g|png|gif|webp|mp4)(?:$|[?#])/i.exec(url);
  return (m?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
}

/** Swap the extension at the end of a path. */
export function withExt(path: string, ext: string): string {
  return path.replace(/\.[a-z0-9]{2,4}$/i, '') + '.' + ext;
}

export function joinPath(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p && p.length > 0).join('/');
}

/**
 * Keep the full relative path under `max` characters by shortening the file stem.
 * Downloads\ plus a typical user folder is about 40 characters, so 180 here keeps
 * the final Windows path under its 260-character limit.
 */
export function fitStem(dir: string, stem: string, ext: string, max = 180): string {
  const fixed = (dir ? dir.length + 1 : 0) + ext.length + 1;
  const room = Math.max(8, max - fixed);
  if (stem.length <= room) return stem;
  return stem.slice(0, room).replace(/[\s\-_.]+$/, '');
}

/** Make a name unique inside one folder (case-insensitive, as on Windows). */
export class NameRegistry {
  private used = new Set<string>();

  take(dir: string, stem: string, ext: string): string {
    let name = `${stem}.${ext}`;
    let n = 2;
    while (this.used.has(`${dir}/${name}`.toLowerCase())) name = `${stem} (${n++}).${ext}`;
    this.used.add(`${dir}/${name}`.toLowerCase());
    return name;
  }
}

export function isoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Windows-style display path, e.g. Downloads\Pinterest Heist\Interior Refs\ */
export function displayPath(rel: string, isFolder = true): string {
  const p = `Downloads\\${rel.replace(/\//g, '\\')}`;
  return isFolder ? `${p}\\` : p;
}
