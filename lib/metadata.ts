export type MetaRow = {
  file: string;
  pinId: string;
  pinUrl: string;
  sourceUrl: string;
  title: string;
  description: string;
  pinner: string;
  board: string;
  section: string;
  kind: string;
  width?: number;
  height?: number;
};

export type Metadata = {
  tool: 'Pinterest Heist';
  version: string;
  createdAt: string;
  name: string;
  page: string;
  items: MetaRow[];
  skipped: { pinId: string; reason: string }[];
  failed: { pinId: string; file: string; reason: string }[];
};

const COLUMNS: (keyof MetaRow)[] = [
  'file', 'pinId', 'pinUrl', 'sourceUrl', 'title', 'description', 'pinner', 'board', 'section', 'kind', 'width', 'height',
];

function cell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a byte-order mark so Excel opens accented titles correctly. */
export function metadataToCSV(m: Metadata): string {
  const lines = [COLUMNS.join(',')];
  for (const row of m.items) lines.push(COLUMNS.map((c) => cell(row[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function metadataToJSON(m: Metadata): string {
  return JSON.stringify(m, null, 2);
}
