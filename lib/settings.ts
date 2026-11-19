import { browser } from 'wxt/browser';
import { DEFAULT_PATTERN } from './naming';
import type { Format } from './plan';

export type Settings = {
  format: Format;
  pattern: string;
  group: boolean;
  includeMeta: boolean;
  skipDupes: boolean;
  tipsSeen: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  format: 'files',
  pattern: DEFAULT_PATTERN,
  group: true,
  includeMeta: true,
  skipDupes: true,
  tipsSeen: false,
};

const KEY = 'heist:settings';

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await browser.storage.local.get(KEY);
    return { ...DEFAULT_SETTINGS, ...((got?.[KEY] as Partial<Settings>) ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  try {
    await browser.storage.local.set({ [KEY]: next });
  } catch {
    /* storage unavailable: keep defaults for this session */
  }
  return next;
}
