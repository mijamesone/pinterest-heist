import { describe, expect, it } from 'vitest';
import { metadataToCSV } from '../lib/metadata';
import { parsePin } from '../lib/pins';
import { buildPlan, type Entry } from '../lib/plan';

const img = (hash: string, ext = 'jpg') => `https://i.pinimg.com/originals/ab/cd/ef/${hash.padEnd(32, '0')}.${ext}`;
const pin = (id: string, hash: string, extra: object = {}) => parsePin({ id, title: `Pin ${id}`, images: { orig: { url: img(hash) } }, ...extra });
const base = { name: 'Interior Refs', format: 'files' as const, pattern: '{board}_{section}_{index}', group: true, includeMeta: true, skipDupes: true };
const now = new Date('2026-11-19T12:00:00Z');

describe('buildPlan', () => {
  it('puts sections in sub-folders and unsorted pins at the root', () => {
    const entries: Entry[] = [
      { pin: pin('1', 'a1'), folder: '', board: 'Interior Refs', section: '' },
      { pin: pin('2', 'a2'), folder: 'Kitchens', board: 'Interior Refs', section: 'Kitchens' },
      { pin: pin('3', 'a3'), folder: 'Kitchens', board: 'Interior Refs', section: 'Kitchens' },
    ];
    const plan = buildPlan(entries, base, now);
    expect(plan.rootDir).toBe('Pinterest Heist/Interior Refs');
    expect(plan.zipPath).toBe('Pinterest Heist/Interior Refs.zip');
    expect(plan.files.map((f) => f.relPath)).toEqual([
      'Interior Refs_001.jpg',
      'Kitchens/Interior Refs_Kitchens_001.jpg',
      'Kitchens/Interior Refs_Kitchens_002.jpg',
    ]);
    expect(plan.files[1].fullPath).toBe('Pinterest Heist/Interior Refs/Kitchens/Interior Refs_Kitchens_001.jpg');
  });

  it('saves straight into Downloads when grouping is off', () => {
    const plan = buildPlan([{ pin: pin('1', 'b1'), folder: '' }], { ...base, group: false }, now);
    expect(plan.rootDir).toBe('Interior Refs');
  });

  it('skips duplicate pins and repins of the same image', () => {
    const plan = buildPlan(
      [
        { pin: pin('1', 'c1'), folder: '' },
        { pin: pin('1', 'c1'), folder: '' },
        { pin: pin('2', 'c1'), folder: '' },
      ],
      base,
      now,
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.metadata.skipped.map((s) => s.reason)).toEqual(['Duplicate pin', 'Same image as pin 1']);
  });

  it('keeps duplicates when asked', () => {
    const plan = buildPlan([{ pin: pin('1', 'd1'), folder: '' }, { pin: pin('2', 'd1'), folder: '' }], { ...base, skipDupes: false }, now);
    expect(plan.files.map((f) => f.relPath)).toEqual(['001.jpg', '002.jpg']);
  });

  it('numbers carousel images as a set', () => {
    const p = parsePin({
      id: '9',
      carousel_data: { carousel_slots: [{ images: { orig: { url: img('e1') } } }, { images: { orig: { url: img('e2', 'png') } } }] },
    });
    const plan = buildPlan([{ pin: p, folder: '', board: 'B' }], base, now);
    expect(plan.files.map((f) => f.relPath)).toEqual(['B_001a.jpg', 'B_001b.png']);
  });

  it('flattens folders for the PureRef handoff', () => {
    const plan = buildPlan(
      [{ pin: pin('1', 'f1'), folder: 'Kitchens', section: 'Kitchens', board: 'B' }],
      { ...base, flat: true, baseDir: 'Pinterest Heist/_PureRef', includeMeta: false },
      now,
    );
    expect(plan.files[0].fullPath).toBe('Pinterest Heist/_PureRef/Interior Refs/B_Kitchens_001.jpg');
  });

  it('lists pins without images as skipped', () => {
    const plan = buildPlan([{ pin: parsePin({ id: '5' }), folder: '' }], base, now);
    expect(plan.files).toHaveLength(0);
    expect(plan.metadata.skipped[0].reason).toMatch(/No image/);
  });

  it('writes CSV that Excel can open', () => {
    const plan = buildPlan([{ pin: pin('1', 'g1', { title: 'Say "hi", ok' }), folder: '' }], base, now);
    const csv = metadataToCSV(plan.metadata);
    expect(csv.startsWith('﻿file,pinId')).toBe(true);
    expect(csv).toContain('"Say ""hi"", ok"');
  });
});
