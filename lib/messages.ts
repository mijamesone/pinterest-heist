import type { Metadata } from './metadata';

/** One file for the background to download. */
export type DownloadItem = {
  candidates: string[];
  /** Relative path under the Downloads folder, forward slashes. */
  path: string;
};

export type ZipFile = { pinId: string; candidates: string[]; path: string };

export type ZipJob = {
  jobId: string;
  tabId?: number;
  zipPath: string;
  files: ZipFile[];
  metadata: Metadata | null;
};

/** Messages sent from the content script to the background. */
export type ContentRequest =
  | { type: 'heist:state' }
  | { type: 'heist:set-active'; active: boolean }
  | { type: 'heist:download-one'; item: DownloadItem }
  | { type: 'heist:download-text'; path: string; mime: string; text: string }
  | { type: 'heist:zip'; job: ZipJob }
  | { type: 'heist:zip-cancel'; jobId: string }
  | { type: 'heist:show'; downloadId: number }
  | { type: 'heist:show-default-folder' }
  | { type: 'heist:fetch-image'; candidates: string[] };

export type DownloadOneResult = { ok: true; downloadId: number; path: string; url: string } | { ok: false; error: string };

/** Messages sent from the background to the content script. */
export type ContentEvent =
  | { type: 'heist:set-active'; active: boolean }
  | { type: 'heist:zip-progress'; jobId: string; done: number; total: number; part: number }
  | { type: 'heist:zip-done'; jobId: string; downloadIds: number[]; failed: { pinId: string; file: string; reason: string }[]; parts: number; cancelled: boolean; error?: string };

/** Messages between the background and the offscreen document. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'ping' }
  | { target: 'offscreen'; type: 'zip-start'; job: ZipJob }
  | { target: 'offscreen'; type: 'zip-cancel'; jobId: string }
  | { target: 'offscreen'; type: 'blob-url'; text: string; mime: string }
  | { target: 'offscreen'; type: 'revoke'; url: string };

export type OffscreenEvent =
  | { target: 'background'; type: 'zip-progress'; jobId: string; tabId?: number; done: number; total: number; part: number }
  | { target: 'background'; type: 'zip-part'; jobId: string; url: string; filename: string }
  | { target: 'background'; type: 'zip-done'; jobId: string; tabId?: number; failed: { pinId: string; file: string; reason: string }[]; parts: number; cancelled: boolean; error?: string };
