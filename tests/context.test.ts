import { describe, expect, it } from 'vitest';
import { humanizeSlug, parseContext, supportsSelectAll } from '../lib/context';

describe('parseContext', () => {
  it('recognises the home feed', () => {
    expect(parseContext('/')).toEqual({ kind: 'home' });
    expect(parseContext('/homefeed/')).toEqual({ kind: 'home' });
  });
  it('recognises a pin page', () => {
    expect(parseContext('/pin/123456789/')).toEqual({ kind: 'pin', pinId: '123456789' });
  });
  it('recognises boards, including board sub-pages', () => {
    expect(parseContext('/jane/interior-refs/')).toMatchObject({ kind: 'board', username: 'jane', slug: 'interior-refs', path: '/jane/interior-refs/' });
    expect(parseContext('/jane/interior-refs/more_ideas/')).toMatchObject({ kind: 'board' });
    expect(parseContext('/jane/interior-refs/_tools/organize/')).toMatchObject({ kind: 'board' });
  });
  it('recognises sections', () => {
    expect(parseContext('/jane/interior-refs/kitchens/')).toEqual({
      kind: 'section', username: 'jane', boardSlug: 'interior-refs', sectionSlug: 'kitchens',
      path: '/jane/interior-refs/kitchens/', boardPath: '/jane/interior-refs/',
    });
  });
  it('recognises profiles and their tabs', () => {
    expect(parseContext('/jane/')).toMatchObject({ kind: 'profile', tab: 'root' });
    expect(parseContext('/jane/_created/')).toMatchObject({ kind: 'profile', tab: 'created' });
    expect(parseContext('/jane/_saved/')).toMatchObject({ kind: 'profile', tab: 'saved' });
    expect(parseContext('/jane/pins/')).toMatchObject({ kind: 'profile', tab: 'pins' });
  });
  it('recognises search with its query', () => {
    expect(parseContext('/search/pins/', '?q=brutalist%20stairs&rs=typed')).toMatchObject({ kind: 'search', query: 'brutalist stairs' });
  });
  it('treats Pinterest features as other pages', () => {
    expect(parseContext('/ideas/')).toMatchObject({ kind: 'other' });
    expect(parseContext('/today/')).toMatchObject({ kind: 'other' });
  });
  it('keeps encoded slugs in paths', () => {
    const c = parseContext('/jane/caf%C3%A9-ideas/');
    expect(c).toMatchObject({ kind: 'board', slug: 'café-ideas', path: '/jane/caf%C3%A9-ideas/' });
  });
});

describe('supportsSelectAll', () => {
  it('is true only for pages with an end', () => {
    expect(supportsSelectAll(parseContext('/jane/board/'))).toBe(true);
    expect(supportsSelectAll(parseContext('/jane/board/section/'))).toBe(true);
    expect(supportsSelectAll(parseContext('/search/pins/', '?q=x'))).toBe(true);
    expect(supportsSelectAll(parseContext('/jane/pins/'))).toBe(true);
    expect(supportsSelectAll(parseContext('/'))).toBe(false);
    expect(supportsSelectAll(parseContext('/pin/1/'))).toBe(false);
    expect(supportsSelectAll(parseContext('/jane/_saved/'))).toBe(false);
  });
});

describe('humanizeSlug', () => {
  it('turns slugs into readable names', () => {
    expect(humanizeSlug('interior-refs')).toBe('Interior Refs');
    expect(humanizeSlug('caf%C3%A9_ideas')).toBe('Café Ideas');
  });
});
