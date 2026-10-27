import { describe, expect, it } from 'vitest';

import { factVariablesOf, factsDocumentOf, readFacts } from '../utils/catalog/catalog-facts';
import { catalogKindOf } from '../utils/catalog/catalog-results';

const manga = catalogKindOf('fetchMangas')!;
const anime = catalogKindOf('fetchAnimes')!;

describe('the lookup of the facts about the rows', () => {
  it('builds one request with a variable and an alias for each slot, with the fields the sorts, the filters and the cards read', () => {
    const document = factsDocumentOf(manga, 2);
    const selection =
      'id slug score views createdAt containExplicitThemes chapters lastChapterAt type formats status source rating originCountry releasedOn completedOn translitionStatus labels { slug }';
    expect(document).toBe(`query catalogRowFacts($s0: String!, $s1: String!) { a0: manga(slug: $s0) { ${selection} } a1: manga(slug: $s1) { ${selection} } }`);
  });

  it('asks the anime lookup for the episodes where the manga lookup asks for the chapters', () => {
    const document = factsDocumentOf(anime, 1);
    expect(document).toContain('a0: anime(slug: $s0) { id slug score views createdAt containExplicitThemes episodes lastEpisodeAt type formats');
    expect(document).not.toContain('chapters');
  });

  it('fills every slot, so one document serves any number of rows, by repeating the last slug', () => {
    expect(factVariablesOf(['a', 'b'], 4)).toEqual({ s0: 'a', s1: 'b', s2: 'b', s3: 'b' });
    expect(factVariablesOf(['a'], 2)).toEqual({ s0: 'a', s1: 'a' });
  });

  it('reads the facts by slug, skipping lookups that came back empty', () => {
    const facts = readFacts({ a0: { slug: 'a', score: 1 }, a1: null, a2: { slug: 'b', score: 2 }, a3: { score: 3 } });
    expect([...facts.keys()]).toEqual(['a', 'b']);
    expect(facts.get('b')?.score).toBe(2);
    expect(readFacts(null).size).toBe(0);
    expect(readFacts(undefined).size).toBe(0);
  });
});
