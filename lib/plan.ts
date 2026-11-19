import type { Metadata, MetaRow } from './metadata';
import { extFromUrl, fitStem, isoDate, joinPath, NameRegistry, padIndex, renderPattern, sanitizeSegment, subLetter } from './naming';
import type { PinInfo } from './pins';

export type Entry = {
  pin: PinInfo;
  /** Sub-folder inside the download ('' for the root). Usually the section title. */
  folder: string;
  board?: string;
  section?: string;
};

export type Format = 'files' | 'zip';

export type PlanOptions = {
  name: string;
  format: Format;
  pattern: string;
  /** Put everything inside Downloads/Pinterest Heist/. */
  group: boolean;
  includeMeta: boolean;
  skipDupes: boolean;
  /** Ignore section folders (used for the PureRef handoff). */
  flat?: boolean;
  /** Override the parent folder, e.g. "Pinterest Heist/_PureRef". */
  baseDir?: string;
  query?: string;
  page?: string;
  origin?: string;
  version?: string;
};

export type PlanFile = {
  pinId: string;
  candidates: string[];
  /** Path inside the download root (also the path inside a ZIP). */
  relPath: string;
  /** Path under the browser's Downloads folder (files mode). */
  fullPath: string;
  meta: MetaRow;
};

export type Plan = {
  name: string;
  rootDir: string;
  zipPath: string;
  files: PlanFile[];
  metadata: Metadata;
};

export function rootFor(opts: Pick<PlanOptions, 'name' | 'group' | 'baseDir'>): { name: string; base: string; rootDir: string; zipPath: string } {
  const name = sanitizeSegment(opts.name, 100) || 'Pinterest Heist download';
  const base = opts.baseDir ?? (opts.group ? 'Pinterest Heist' : '');
  return { name, base, rootDir: joinPath(base, name), zipPath: joinPath(base, `${name}.zip`) };
}

export function buildPlan(entries: Entry[], opts: PlanOptions, now = new Date()): Plan {
  const { name, rootDir, zipPath } = rootFor(opts);
  const origin = opts.origin ?? 'https://www.pinterest.com';
  const date = isoDate(now);
  const names = new NameRegistry();
  const seenPins = new Map<string, string>();
  const seenImages = new Map<string, string>();
  const counters = new Map<string, number>();
  const files: PlanFile[] = [];
  const skipped: Metadata['skipped'] = [];

  // First pass: decide what is kept, so index padding matches the real count.
  const kept: Entry[] = [];
  for (const e of entries) {
    const pin = e.pin;
    if (!pin.media.length) {
      skipped.push({ pinId: pin.id, reason: 'No image found for this pin' });
      continue;
    }
    if (opts.skipDupes) {
      if (seenPins.has(pin.id)) {
        skipped.push({ pinId: pin.id, reason: 'Duplicate pin' });
        continue;
      }
      const same = seenImages.get(pin.signature);
      if (same) {
        skipped.push({ pinId: pin.id, reason: `Same image as pin ${same}` });
        continue;
      }
    }
    seenPins.set(pin.id, pin.id);
    seenImages.set(pin.signature, pin.id);
    kept.push(e);
  }

  const perFolder = new Map<string, number>();
  for (const e of kept) {
    const f = opts.flat ? '' : sanitizeSegment(e.folder);
    perFolder.set(f, (perFolder.get(f) ?? 0) + 1);
  }

  for (const e of kept) {
    const pin = e.pin;
    const folder = opts.flat ? '' : sanitizeSegment(e.folder);
    const n = (counters.get(folder) ?? 0) + 1;
    counters.set(folder, n);
    const idx = padIndex(n, perFolder.get(folder) ?? n);
    const multi = pin.media.length > 1;
    const hasIndexToken = opts.pattern.includes('{index}');

    pin.media.forEach((m, j) => {
      const sub = multi ? subLetter(j) : '';
      let stem = renderPattern(opts.pattern, {
        board: e.board ?? pin.board ?? '',
        section: e.section ?? '',
        index: idx + sub,
        pinId: pin.id,
        title: pin.title || pin.description.slice(0, 60),
        pinner: pin.pinner,
        date,
        query: opts.query ?? '',
      });
      if (!stem) stem = idx + sub;
      else if (multi && !hasIndexToken) stem = `${stem}_${sub}`;

      const ext = extFromUrl(m.candidates[0] ?? '');
      const dirForLength = joinPath(rootDir, folder);
      stem = fitStem(dirForLength, stem, ext);
      const fileName = names.take(folder, stem, ext);
      const relPath = joinPath(folder, fileName);
      files.push({
        pinId: pin.id,
        candidates: m.candidates,
        relPath,
        fullPath: joinPath(rootDir, relPath),
        meta: {
          file: relPath,
          pinId: pin.id,
          pinUrl: `${origin}/pin/${pin.id}/`,
          sourceUrl: pin.link,
          title: pin.title,
          description: pin.description,
          pinner: pin.pinner,
          board: e.board ?? pin.board ?? '',
          section: e.section ?? '',
          kind: m.kind,
          width: m.width,
          height: m.height,
        },
      });
    });
  }

  return {
    name,
    rootDir,
    zipPath,
    files,
    metadata: {
      tool: 'Pinterest Heist',
      version: opts.version ?? '0.1.0',
      createdAt: now.toISOString(),
      name,
      page: opts.page ?? '',
      items: files.map((f) => f.meta),
      skipped,
      failed: [],
    },
  };
}
