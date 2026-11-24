import { describe, expect, it } from 'vitest';
import { getDoc, searchDocs } from '../src/server/tools/docs.js';

describe('docs search', () => {
  it('finds the frame export entry', () => {
    const results = searchDocs('save frame png');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('comp.saveFrameToPng');
  });

  it('finds keyframe easing', () => {
    const results = searchDocs('keyframe ease');
    expect(results.some((result) => result.id === 'keyframe.ease')).toBe(true);
  });

  it('returns compact matches without the body', () => {
    const results = searchDocs('mask');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).not.toHaveProperty('body');
    expect(results[0]).toHaveProperty('summary');
    expect(results[0]).toHaveProperty('url');
  });

  it('returns an empty list for nonsense', () => {
    expect(searchDocs('zzzz-nothing-here')).toEqual([]);
  });
});

describe('docs get', () => {
  it('returns the full entry', () => {
    const entry = getDoc('text.sourceText');
    expect(entry.title).toBe('TextDocument');
    expect(entry.body.length).toBeGreaterThan(20);
  });

  it('throws a helpful error for an unknown id', () => {
    expect(() => getDoc('missing.entry')).toThrowError(/No bundled doc entry/);
  });
});
