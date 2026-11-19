/**
 * Pinterest image URLs look like
 *   https://i.pinimg.com/<size>/ab/cd/ef/<hash>.<ext>
 * where <size> is "originals", "736x", "236x", "1200x", "474x" … The hash is the same
 * for every size, which makes it a good duplicate signature.
 */
const PINIMG = /^(https?:\/\/i\.pinimg\.com)\/[^/]+\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]+)\.(jpe?g|png|gif|webp)(?:[?#].*)?$/i;

export type PinimgParts = { host: string; dirs: string; hash: string; ext: string };

export function parsePinimg(url: string): PinimgParts | null {
  const m = PINIMG.exec(url);
  if (!m) return null;
  return { host: m[1], dirs: `${m[2]}/${m[3]}/${m[4]}`, hash: m[5], ext: m[6].toLowerCase().replace('jpeg', 'jpg') };
}

export function imageSignature(url: string): string {
  return parsePinimg(url)?.hash ?? url;
}

function uniq(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

/** A URL Pinterest gave us as the original: try it, then fall back to large sizes. */
export function candidatesFromKnown(url: string): string[] {
  const p = parsePinimg(url);
  if (!p) return [url];
  return uniq([
    url,
    `${p.host}/originals/${p.dirs}/${p.hash}.${p.ext}`,
    `${p.host}/1200x/${p.dirs}/${p.hash}.jpg`,
    `${p.host}/736x/${p.dirs}/${p.hash}.jpg`,
  ]);
}

/**
 * Only a thumbnail is known (from the page). Thumbnails are always .jpg, while the
 * original may be .png, .gif or .webp, so every extension is tried before falling back.
 */
export function candidatesFromThumb(url: string): string[] {
  const p = parsePinimg(url);
  if (!p) return [url];
  const exts = uniq([p.ext, 'jpg', 'png', 'gif', 'webp']);
  return uniq([
    ...exts.map((e) => `${p.host}/originals/${p.dirs}/${p.hash}.${e}`),
    `${p.host}/1200x/${p.dirs}/${p.hash}.jpg`,
    `${p.host}/736x/${p.dirs}/${p.hash}.jpg`,
    url,
  ]);
}

/** Largest URL from an <img>'s srcset, falling back to src. */
export function bestImgSrc(img: HTMLImageElement): string {
  const set = img.getAttribute('srcset');
  if (set) {
    let best = { url: '', w: 0 };
    for (const part of set.split(',')) {
      const [u, d] = part.trim().split(/\s+/);
      const w = parseFloat(d ?? '1') * (d?.endsWith('x') ? 1000 : 1);
      if (u && w >= best.w) best = { url: u, w };
    }
    if (best.url) return best.url;
  }
  return img.currentSrc || img.src;
}
