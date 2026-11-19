import { describe, expect, it } from 'vitest';
import { displayPath, extFromUrl, fitStem, NameRegistry, padIndex, renderPattern, sanitizeSegment, subLetter, withExt } from '../lib/naming';

describe('sanitizeSegment', () => {
  it('removes characters Windows forbids', () => {
    expect(sanitizeSegment('a<b>c:d"e/f\\g|h?i*j')).toBe('a b c d e f g h i j');
  });
  it('strips trailing dots and spaces', () => {
    expect(sanitizeSegment('  Kitchens... ')).toBe('Kitchens');
  });
  it('renames reserved device names', () => {
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('lpt1.txt')).toBe('_lpt1.txt');
    expect(sanitizeSegment('Console')).toBe('Console');
  });
  it('limits length', () => {
    expect(sanitizeSegment('x'.repeat(200), 50)).toHaveLength(50);
  });
});

describe('renderPattern', () => {
  const v = { board: 'Interior Refs', section: 'Kitchens', index: '001', pinId: '42', title: 'Spiral: stair?', pinner: 'jo', date: '2026-11-19' };
  it('fills tokens', () => {
    expect(renderPattern('{board}_{section}_{index}', v)).toBe('Interior Refs_Kitchens_001');
  });
  it('collapses separators left by empty tokens', () => {
    expect(renderPattern('{board}_{section}_{index}', { ...v, section: '' })).toBe('Interior Refs_001');
    expect(renderPattern('{board} - {section} - {index}', { ...v, section: '' })).toBe('Interior Refs - 001');
    expect(renderPattern('{section}_{index}', { ...v, section: '' })).toBe('001');
  });
  it('sanitises token values', () => {
    expect(renderPattern('{title}', v)).toBe('Spiral stair');
  });
  it('leaves unknown tokens empty', () => {
    expect(renderPattern('{nope}_{index}', v)).toBe('001');
  });
});

describe('helpers', () => {
  it('pads indexes to at least three digits', () => {
    expect(padIndex(7, 20)).toBe('007');
    expect(padIndex(7, 2000)).toBe('0007');
  });
  it('makes sub letters for carousels', () => {
    expect([0, 1, 25, 26, 27].map(subLetter)).toEqual(['a', 'b', 'z', 'aa', 'ab']);
  });
  it('reads and swaps extensions', () => {
    expect(extFromUrl('https://i.pinimg.com/originals/aa/bb/cc/x.PNG')).toBe('png');
    expect(extFromUrl('https://i.pinimg.com/originals/aa/bb/cc/x.jpeg?x=1')).toBe('jpg');
    expect(extFromUrl('https://example.com/noext')).toBe('jpg');
    expect(withExt('A/b_001.jpg', 'png')).toBe('A/b_001.png');
  });
  it('keeps paths short enough for Windows', () => {
    const stem = fitStem('Pinterest Heist/' + 'b'.repeat(100), 's'.repeat(200), 'jpg');
    expect(('Pinterest Heist/' + 'b'.repeat(100) + '/' + stem + '.jpg').length).toBeLessThanOrEqual(180);
  });
  it('makes names unique per folder, ignoring case', () => {
    const r = new NameRegistry();
    expect(r.take('', 'A', 'jpg')).toBe('A.jpg');
    expect(r.take('', 'a', 'jpg')).toBe('a (2).jpg');
    expect(r.take('Kitchens', 'A', 'jpg')).toBe('A.jpg');
  });
  it('shows Windows-style paths', () => {
    expect(displayPath('Pinterest Heist/Interior Refs')).toBe('Downloads\\Pinterest Heist\\Interior Refs\\');
    expect(displayPath('Pinterest Heist/x.zip', false)).toBe('Downloads\\Pinterest Heist\\x.zip');
  });
});
