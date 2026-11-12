import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/modules/search/service';

describe('parseQuery', () => {
  it('quotes every token and prefix-matches only the last bare word', () => {
    expect(parseQuery('hello world')).toMatchObject({ fts: '"hello" "world"*', terms: ['hello', 'world'], exclude: [] });
    expect(parseQuery('"exact phrase"')).toMatchObject({ fts: '"exact phrase"', terms: ['exact phrase'] });
    expect(parseQuery('"exact phrase" tail').fts).toBe('"exact phrase" "tail"*');
    expect(parseQuery('a -b -"c d"')).toMatchObject({ fts: '"a" NOT "b" NOT "c d"', exclude: ['b', 'c d'] });
  });
  it('strips punctuation and FTS syntax; returns null with no positive terms', () => {
    expect(parseQuery('foo-bar').fts).toBe('"foo bar"*');
    expect(parseQuery('AND OR NOT').fts).toBe('"AND" "OR" "NOT"*'); // operators are just words once quoted
    expect(parseQuery('col:val*').fts).toBe('"col val"*');
    for (const q of ['', '   ', '-x', '"', '*', '()', '🚀', '#']) expect(parseQuery(q).fts).toBeNull();
    expect(parseQuery('🚀')).toMatchObject({ terms: ['🚀'] }); // still usable for title/folder/file substring matches
    expect(parseQuery('# -@')).toMatchObject({ terms: ['#'], exclude: ['@'] });
  });
  it('caps the number of terms', () => {
    const many = parseQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '));
    expect(many.terms.length).toBeLessThanOrEqual(12);
  });
});
