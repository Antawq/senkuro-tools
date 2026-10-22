import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { isComplete, readCollection, saveCollection, type Collection } from '../utils/profile/profile-store';
import { MS_PER_MINUTE } from '../utils/shared/time';

const collection = (over: Partial<Collection> = {}): Collection => ({
  at: Date.now(),
  userId: 'u1',
  cards: [{ slug: 'a-a', quantity: 2, shard: true }],
  after: null,
  pages: 1,
  ...over,
});

const stale = () => Date.now() - 11 * MS_PER_MINUTE;

beforeEach(() => {
  fakeBrowser.reset();
});

describe('profile store', () => {
  it('gives a saved collection back to any reader of extension storage', async () => {
    const saved = collection({ after: 'c1' });
    await saveCollection('phaivroh', saved);
    expect(await readCollection('phaivroh')).toEqual(saved);
    expect(await readCollection('chu')).toBeNull();
  });

  it('forgets a collection started more than ten minutes ago', async () => {
    await saveCollection('phaivroh', collection({ at: stale() }));
    expect(await readCollection('phaivroh')).toBeNull();
  });

  it('drops the expired collections of other profiles when it saves', async () => {
    await saveCollection('old', collection({ at: stale() }));
    await saveCollection('phaivroh', collection());
    const { profileCollections } = await fakeBrowser.storage.local.get('profileCollections');
    expect(Object.keys(profileCollections as object)).toEqual(['phaivroh']);
  });

  it('ignores entries it cannot read', async () => {
    await fakeBrowser.storage.local.set({ profileCollections: { a: 5, b: { at: 'now' }, c: { at: Date.now(), userId: 'u', pages: 1, after: 7 } } });
    expect(await Promise.all(['a', 'b', 'c'].map((slug) => readCollection(slug)))).toEqual([null, null, null]);
  });

  it('tells a finished collection from a paused or an empty one', () => {
    expect(isComplete(collection())).toBe(true);
    expect(isComplete(collection({ after: 'c1' }))).toBe(false);
    expect(isComplete(collection({ pages: 0 }))).toBe(false);
  });
});
