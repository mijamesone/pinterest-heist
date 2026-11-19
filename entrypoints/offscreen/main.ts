/**
 * Offscreen document: the only extension context that can both fetch images without CORS
 * limits and create blob: URLs. It builds ZIP archives (split into parts so the browser
 * never holds more than about 800 MB at once) and turns text into downloadable files.
 */
import { downloadZip } from 'client-zip';
import { browser } from 'wxt/browser';
import { metadataToCSV, metadataToJSON } from '../../lib/metadata';
import type { OffscreenEvent, OffscreenRequest, ZipJob } from '../../lib/messages';
import { extFromUrl, withExt } from '../../lib/naming';

const PART_LIMIT = 800 * 1024 * 1024;
const cancelled = new Set<string>();

browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  const req = msg as OffscreenRequest;
  switch (req.type) {
    case 'ping':
      sendResponse({ ok: true });
      return false;
    case 'zip-start':
      void runZip(req.job);
      sendResponse({ ok: true });
      return false;
    case 'zip-cancel':
      cancelled.add(req.jobId);
      sendResponse({ ok: true });
      return false;
    case 'blob-url':
      sendResponse({ ok: true, url: URL.createObjectURL(new Blob([req.text], { type: req.mime })) });
      return false;
    case 'revoke':
      URL.revokeObjectURL(req.url);
      sendResponse({ ok: true });
      return false;
  }
  return false;
});

function send(ev: OffscreenEvent): Promise<any> {
  return browser.runtime.sendMessage(ev);
}

async function fetchFirst(candidates: string[]): Promise<{ blob: Blob; url: string } | null> {
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return { blob: await res.blob(), url };
    } catch {
      /* try next */
    }
  }
  return null;
}

type ZipEntry = { name: string; input: Blob | string; lastModified: Date };

async function runZip(job: ZipJob) {
  const failed: { pinId: string; file: string; reason: string }[] = [];
  const total = job.files.length;
  const base = job.zipPath.replace(/\.zip$/i, '');
  let part = 1;
  let entries: ZipEntry[] = [];
  let bytes = 0;
  let done = 0;
  let error: string | undefined;
  const now = new Date();

  const finalize = async (isLast: boolean) => {
    if (!entries.length) return;
    const filename = isLast && part === 1 ? job.zipPath : `${base} (part ${part}).zip`;
    const blob = await downloadZip(entries).blob();
    const url = URL.createObjectURL(blob);
    try {
      const res = await send({ target: 'background', type: 'zip-part', jobId: job.jobId, url, filename });
      if (!res?.ok) throw new Error(res?.error ?? 'Saving the ZIP failed');
    } finally {
      URL.revokeObjectURL(url);
    }
    entries = [];
    bytes = 0;
    part++;
  };

  try {
    const BATCH = 4;
    for (let i = 0; i < total; i += BATCH) {
      if (cancelled.has(job.jobId)) break;
      const batch = job.files.slice(i, i + BATCH);
      const got = await Promise.all(batch.map((f) => fetchFirst(f.candidates)));
      for (let k = 0; k < batch.length; k++) {
        const f = batch[k];
        const r = got[k];
        done++;
        if (!r) {
          failed.push({ pinId: f.pinId, file: f.path, reason: 'Image not available at any size' });
          continue;
        }
        if (bytes > 0 && bytes + r.blob.size > PART_LIMIT) await finalize(false);
        entries.push({ name: withExt(f.path, extFromUrl(r.url)), input: r.blob, lastModified: now });
        bytes += r.blob.size;
      }
      void send({ target: 'background', type: 'zip-progress', jobId: job.jobId, tabId: job.tabId, done, total, part });
    }

    if (job.metadata && !cancelled.has(job.jobId)) {
      const meta = { ...job.metadata, failed };
      const failedFiles = new Set(failed.map((f) => f.file));
      meta.items = meta.items.filter((it) => !failedFiles.has(it.file));
      entries.push({ name: 'metadata.json', input: metadataToJSON(meta), lastModified: now });
      entries.push({ name: 'metadata.csv', input: metadataToCSV(meta), lastModified: now });
    }
    if (!cancelled.has(job.jobId)) await finalize(true);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  await send({
    target: 'background',
    type: 'zip-done',
    jobId: job.jobId,
    tabId: job.tabId,
    failed,
    parts: part - 1,
    cancelled: cancelled.has(job.jobId),
    error,
  });
  cancelled.delete(job.jobId);
}
