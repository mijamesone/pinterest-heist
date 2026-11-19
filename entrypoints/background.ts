import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { isPinterestUrl } from '../lib/domains';
import type { ContentEvent, ContentRequest, DownloadOneResult, OffscreenEvent, OffscreenRequest } from '../lib/messages';
import { extFromUrl, withExt } from '../lib/naming';

const RED = '#E60023';
const stateKey = (tabId: number) => `active:${tabId}`;

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    if (tab.id != null) void toggle(tab.id, tab.url);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(stateKey(tabId)).catch(() => {});
  });

  browser.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
    if (msg?.target === 'offscreen') return false;
    if (msg?.target === 'background') {
      handleOffscreen(msg as OffscreenEvent).then(sendResponse, (e) => sendResponse({ ok: false, error: errText(e) }));
      return true;
    }
    if (typeof msg?.type !== 'string' || !msg.type.startsWith('heist:')) return false;
    handleContent(msg as ContentRequest, sender.tab?.id).then(sendResponse, (e) => sendResponse({ ok: false, error: errText(e) }));
    return true;
  });
});

// ---------------------------------------------------------------- activation

async function isActive(tabId: number): Promise<boolean> {
  try {
    const got = await browser.storage.session.get(stateKey(tabId));
    return got?.[stateKey(tabId)] === true;
  } catch {
    return false;
  }
}

async function setBadge(tabId: number, active: boolean) {
  try {
    await browser.action.setBadgeBackgroundColor({ tabId, color: RED });
    await browser.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
  } catch {
    /* tab gone */
  }
}

async function toggle(tabId: number, url?: string) {
  if (!isPinterestUrl(url)) {
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#555' });
    await browser.action.setBadgeText({ tabId, text: 'PIN' });
    await browser.action.setTitle({ tabId, title: 'Pinterest Heist works on pinterest.com. Open Pinterest and click again.' });
    setTimeout(() => void browser.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 2500);
    return;
  }
  await setActive(tabId, !(await isActive(tabId)));
}

async function setActive(tabId: number, active: boolean) {
  await browser.storage.session.set({ [stateKey(tabId)]: active }).catch(() => {});
  await setBadge(tabId, active);
  const msg: ContentEvent = { type: 'heist:set-active', active };
  try {
    await browser.tabs.sendMessage(tabId, msg);
  } catch {
    // Tabs opened before the extension was installed have no content script yet.
    if (!active) return;
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
      await new Promise((r) => setTimeout(r, 150));
      await browser.tabs.sendMessage(tabId, msg);
    } catch {
      await browser.storage.session.set({ [stateKey(tabId)]: false }).catch(() => {});
      await setBadge(tabId, false);
    }
  }
}

// ---------------------------------------------------------------- content requests

async function handleContent(msg: ContentRequest, tabId: number | undefined): Promise<unknown> {
  switch (msg.type) {
    case 'heist:state': {
      const active = tabId != null ? await isActive(tabId) : false;
      if (tabId != null) await setBadge(tabId, active);
      return { active };
    }
    case 'heist:set-active':
      if (tabId != null) await setActive(tabId, msg.active);
      return { ok: true };
    case 'heist:download-one':
      return downloadOne(msg.item.candidates, msg.item.path);
    case 'heist:download-text':
      return downloadText(msg.path, msg.mime, msg.text);
    case 'heist:zip':
      await ensureOffscreen();
      await toOffscreen({ target: 'offscreen', type: 'zip-start', job: { ...msg.job, tabId } });
      return { ok: true };
    case 'heist:zip-cancel':
      await toOffscreen({ target: 'offscreen', type: 'zip-cancel', jobId: msg.jobId }).catch(() => {});
      return { ok: true };
    case 'heist:show':
      try {
        browser.downloads.show(msg.downloadId);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    case 'heist:show-default-folder':
      browser.downloads.showDefaultFolder();
      return { ok: true };
    case 'heist:fetch-image':
      return fetchImage(msg.candidates);
  }
}

// ---------------------------------------------------------------- downloads

/** First candidate URL that exists. Probes with HEAD, falling back to a 1-byte GET. */
async function resolveFirst(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    try {
      let res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return url;
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
        if (res.ok || res.status === 206) return url;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function waitForDownload(id: number, timeoutMs = 180_000): Promise<'complete' | 'interrupted' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (s: 'complete' | 'interrupted' | 'timeout') => {
      if (settled) return;
      settled = true;
      browser.downloads.onChanged.removeListener(listener);
      clearTimeout(timer);
      resolve(s);
    };
    const listener = (delta: any) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') finish('complete');
      if (delta.state.current === 'interrupted') finish('interrupted');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    browser.downloads.onChanged.addListener(listener);
    // It may already have finished before the listener was attached.
    void browser.downloads.search({ id }).then(([item]) => {
      if (item?.state === 'complete') finish('complete');
      if (item?.state === 'interrupted') finish('interrupted');
    });
  });
}

async function startDownload(url: string, filename: string): Promise<{ ok: true; downloadId: number } | { ok: false; error: string }> {
  try {
    const downloadId = await browser.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    const state = await waitForDownload(downloadId);
    if (state === 'complete') return { ok: true, downloadId };
    return { ok: false, error: state === 'timeout' ? 'Download took too long' : 'Download was interrupted' };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

async function downloadOne(candidates: string[], path: string): Promise<DownloadOneResult> {
  const url = await resolveFirst(candidates);
  if (!url) return { ok: false, error: 'Image not available at any size' };
  const finalPath = withExt(path, extFromUrl(url));
  const res = await startDownload(url, finalPath);
  return res.ok ? { ok: true, downloadId: res.downloadId, path: finalPath, url } : res;
}

async function downloadText(path: string, mime: string, text: string) {
  await ensureOffscreen();
  const { url } = (await toOffscreen({ target: 'offscreen', type: 'blob-url', text, mime })) as { url: string };
  const res = await startDownload(url, path);
  void toOffscreen({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
  return res;
}

async function fetchImage(candidates: string[]) {
  const url = await resolveFirst(candidates);
  if (!url) return { ok: false, error: 'Image not available' };
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const type = res.headers.get('content-type') ?? 'image/jpeg';
  return { ok: true, dataUrl: `data:${type};base64,${btoa(bin)}` };
}

// ---------------------------------------------------------------- offscreen document (ZIP + text files)

let creating: Promise<void> | null = null;

async function ensureOffscreen() {
  const url = browser.runtime.getURL('/offscreen.html');
  const rt = browser.runtime as any;
  const existing = rt.getContexts ? await rt.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] }) : [];
  if (existing?.length) return;
  if (!creating) {
    creating = (browser as any).offscreen
      .createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Build ZIP archives and metadata files for download' })
      .catch((e: unknown) => {
        if (!String(e).includes('single offscreen')) throw e;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
  // Wait until its message listener is ready.
  for (let i = 0; i < 20; i++) {
    try {
      const pong = await browser.runtime.sendMessage({ target: 'offscreen', type: 'ping' } satisfies OffscreenRequest);
      if (pong?.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function toOffscreen(msg: OffscreenRequest): Promise<any> {
  return browser.runtime.sendMessage(msg);
}

const zipDownloads = new Map<string, number[]>();

async function handleOffscreen(msg: OffscreenEvent): Promise<unknown> {
  switch (msg.type) {
    case 'zip-progress':
      if (msg.tabId != null) {
        const ev: ContentEvent = { type: 'heist:zip-progress', jobId: msg.jobId, done: msg.done, total: msg.total, part: msg.part };
        void browser.tabs.sendMessage(msg.tabId, ev).catch(() => {});
      }
      return { ok: true };
    case 'zip-part': {
      const res = await startDownload(msg.url, msg.filename);
      if (res.ok) zipDownloads.set(msg.jobId, [...(zipDownloads.get(msg.jobId) ?? []), res.downloadId]);
      return res;
    }
    case 'zip-done': {
      const ids = zipDownloads.get(msg.jobId) ?? [];
      zipDownloads.delete(msg.jobId);
      if (msg.tabId != null) {
        const ev: ContentEvent = {
          type: 'heist:zip-done',
          jobId: msg.jobId,
          downloadIds: ids,
          failed: msg.failed,
          parts: msg.parts,
          cancelled: msg.cancelled,
          error: msg.error,
        };
        void browser.tabs.sendMessage(msg.tabId, ev).catch(() => {});
      }
      return { ok: true };
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
