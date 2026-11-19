import { describe, expect, it } from 'vitest';
import { candidatesFromKnown, candidatesFromThumb, imageSignature } from '../lib/images';
import { isPinItem, parsePin, pinFromThumb } from '../lib/pins';

const H = 'https://i.pinimg.com';
const img = (size: string, ext = 'jpg', hash = 'abcdef0123456789abcdef0123456789') => `${H}/${size}/ab/cd/ef/${hash}.${ext}`;

describe('image candidates', () => {
  it('tries the known original first, then large sizes', () => {
    expect(candidatesFromKnown(img('originals', 'png'))).toEqual([img('originals', 'png'), img('1200x'), img('736x')]);
  });
  it('tries every original extension when only a thumbnail is known', () => {
    const c = candidatesFromThumb(img('236x'));
    expect(c.slice(0, 4)).toEqual([img('originals', 'jpg'), img('originals', 'png'), img('originals', 'gif'), img('originals', 'webp')]);
    expect(c.at(-1)).toBe(img('236x'));
  });
  it('uses the hash as a signature across sizes', () => {
    expect(imageSignature(img('236x'))).toBe(imageSignature(img('originals', 'png')));
  });
});

describe('parsePin', () => {
  it('reads an ordinary pin', () => {
    const p = parsePin({
      id: '1', type: 'pin', title: ' Concrete  stair ', description: 'desc', link: 'https://src.example',
      pinner: { username: 'jo' }, board: { name: 'Interior Refs' },
      images: { '236x': { url: img('236x'), width: 236 }, orig: { url: img('originals', 'png'), width: 2000, height: 3000 } },
    });
    expect(p).toMatchObject({ id: '1', title: 'Concrete stair', pinner: 'jo', board: 'Interior Refs', isVideo: false, needsDetail: false });
    expect(p.media).toHaveLength(1);
    expect(p.media[0]).toMatchObject({ kind: 'image', width: 2000, height: 3000 });
    expect(p.media[0].candidates[0]).toBe(img('originals', 'png'));
  });
  it('picks the largest size when there is no original', () => {
    const p = parsePin({ id: '2', images: { '236x': { url: img('236x'), width: 236 }, '736x': { url: img('736x'), width: 736 } } });
    expect(p.media[0].candidates[0]).toBe(img('736x'));
  });
  it('reads every carousel image', () => {
    const p = parsePin({
      id: '3',
      images: { orig: { url: img('originals', 'jpg', '1'.repeat(32)) } },
      carousel_data: { carousel_slots: [{ images: { orig: { url: img('originals', 'jpg', 'a'.repeat(32)) } } }, { images: { orig: { url: img('originals', 'jpg', 'b'.repeat(32)) } } }] },
    });
    expect(p.media).toHaveLength(2);
  });
  it('reads Idea Pin pages, using video covers', () => {
    const p = parsePin({
      id: '4',
      story_pin_data_id: '99',
      story_pin_data: {
        pages: [
          { blocks: [{ image: { images: { originals: { url: img('originals', 'jpg', 'c'.repeat(32)) } } } }] },
          { blocks: [{ video: { video_list: { V_EXP7: { url: 'https://v.pinimg.com/x.mp4', thumbnail: img('originals', 'jpg', 'd'.repeat(32)) } } } }] },
        ],
      },
    });
    expect(p.media.map((m) => m.kind)).toEqual(['image', 'video-cover']);
    expect(p.isVideo).toBe(true);
    expect(p.needsDetail).toBe(false);
  });
  it('flags Idea Pins without pages for a detail fetch', () => {
    expect(parsePin({ id: '5', story_pin_data_id: '9', images: { orig: { url: img('originals') } } }).needsDetail).toBe(true);
  });
  it('marks video pins as covers', () => {
    const p = parsePin({ id: '6', videos: { video_list: { V_720P: { url: 'x.mp4' } } }, images: { orig: { url: img('originals') } } });
    expect(p.media[0].kind).toBe('video-cover');
  });
  it('detects GIFs', () => {
    expect(parsePin({ id: '7', images: { orig: { url: img('originals', 'gif') } } }).media[0].kind).toBe('gif');
  });
});

describe('feed helpers', () => {
  it('keeps pins and drops other feed items', () => {
    expect(isPinItem({ id: '1', type: 'pin' })).toBe(true);
    expect(isPinItem({ id: '1', type: 'story' })).toBe(false);
    expect(isPinItem({ id: '1', images: {} })).toBe(true);
    expect(isPinItem(null)).toBe(false);
  });
  it('builds a fallback pin from a thumbnail', () => {
    const p = pinFromThumb('8', img('236x'), 'Title');
    expect(p.media[0].candidates[0]).toBe(img('originals'));
  });
});
