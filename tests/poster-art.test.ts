import { describe, expect, it, vi } from 'vitest';

import { Kind, parse, print, type FieldNode, type OperationDefinitionNode } from '@0no-co/graphql.web';

import { ART_BATCH_SIZE, fetchPosterArt, loadArtImage, type PosterArt } from '../utils/poster/poster-art';
import { ApiError, type Transport } from '../utils/shared/graphql';

const ART_WIDTH_PX = 400;
const ART_HEIGHT_PX = 600;

interface PostedRequest {
  query: string;
  operationName: string;
  variables: Record<string, string>;
}

const urlOf = (slug: string): string => `https://cdn.senkuro.com/cards/${slug}.webp`;

const cardOf = (slug: string): Record<string, unknown> => ({
  slug,
  rank: 'S',
  explicit: false,
  image: { original: { url: urlOf(slug), width: ART_WIDTH_PX, height: ART_HEIGHT_PX } },
});

const jsonReply = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const serverOf = (answerFor: (slug: string) => unknown = cardOf, replyOf = (cards: Record<string, unknown>): unknown => ({ data: cards })) => {
  const requests: PostedRequest[] = [];
  let inFlightCount = 0;
  let peakInFlightCount = 0;
  const transport: Transport = {
    fetch: async (_input, init) => {
      const request = JSON.parse(init?.body as string) as PostedRequest;
      requests.push(request);
      inFlightCount++;
      peakInFlightCount = Math.max(peakInFlightCount, inFlightCount);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlightCount--;
      const cards = Object.fromEntries(Object.entries(request.variables).map(([name, slug]) => [name.replace('slug', 'card'), answerFor(slug)]));
      return jsonReply(replyOf(cards));
    },
    sleep: () => Promise.resolve(),
    random: () => 0,
  };
  return { transport, requests, peakInFlightCount: () => peakInFlightCount };
};

const operationOf = (query: string): OperationDefinitionNode => {
  const definition = parse(query).definitions[0];
  if (definition?.kind !== Kind.OPERATION_DEFINITION) throw new Error('the query holds no operation');
  return definition;
};

const ART: PosterArt = { slug: 'alpha-s', rank: 'S', url: urlOf('alpha-s'), width: ART_WIDTH_PX, height: ART_HEIGHT_PX, isExplicit: false };

const bitmapOf = (): ImageBitmap => ({ width: ART_WIDTH_PX, height: ART_HEIGHT_PX, close: () => undefined });

const imageHost = (answer: () => Promise<Response> = () => Promise.resolve(new Response(new Blob(['art']), { status: 200 }))) => {
  const bitmap = bitmapOf();
  const fetchImage = vi.fn<(url: string) => Promise<Response>>(() => answer());
  const createBitmap = vi.fn<(blob: Blob) => Promise<ImageBitmap>>(() => Promise.resolve(bitmap));
  return { bitmap, fetchImage, createBitmap, host: { fetchImage, createBitmap } };
};

describe('fetchPosterArt', () => {
  it('asks for every slug in one PosterArt query with a String! variable and an alias per card', async () => {
    const { transport, requests } = serverOf();
    await fetchPosterArt(['alpha-s', 'beta-a'], transport);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.operationName).toBe('PosterArt');
    expect(request?.variables).toEqual({ slug0: 'alpha-s', slug1: 'beta-a' });
    const operation = operationOf(request?.query ?? '');
    expect(operation.name?.value).toBe('PosterArt');
    expect(operation.variableDefinitions?.map((definition) => [definition.variable.name.value, print(definition.type)])).toEqual([
      ['slug0', 'String!'],
      ['slug1', 'String!'],
    ]);
    const fields = operation.selectionSet.selections as FieldNode[];
    expect(fields.map((field) => [field.alias?.value, field.name.value, field.arguments?.map((argument) => print(argument)).join(', ')])).toEqual([
      ['card0', 'card', 'slug: $slug0'],
      ['card1', 'card', 'slug: $slug1'],
    ]);
    expect(request?.query).toContain('{ slug rank explicit image { original { url width height } } }');
  });

  it('maps each asked slug to its art with the rank, the size and the 18+ flag', async () => {
    const { transport } = serverOf((slug) => ({ ...cardOf(slug), explicit: slug === 'adult-x' }));
    const arts = await fetchPosterArt(['alpha-s', 'adult-x'], transport);
    expect(arts.get('alpha-s')).toEqual(ART);
    expect(arts.get('adult-x')).toEqual({ ...ART, slug: 'adult-x', url: urlOf('adult-x'), isExplicit: true });
  });

  it('leaves out a card that is missing, has no image, a url that is not https or a size that is not a positive number', async () => {
    const cardWithOriginal = (slug: string, change: Record<string, unknown>) => ({
      ...cardOf(slug),
      image: { original: { url: urlOf(slug), width: 1, height: 1, ...change } },
    });
    const answers: Record<string, unknown> = {
      'kept-s': cardOf('kept-s'),
      'gone-s': null,
      'no-image-s': { ...cardOf('no-image-s'), image: null },
      'no-original-s': { ...cardOf('no-original-s'), image: { original: null } },
      'plain-http-s': cardWithOriginal('plain-http-s', { url: 'http://cdn.senkuro.com/cards/plain-http-s.webp' }),
      'no-width-s': cardWithOriginal('no-width-s', { width: null }),
      'text-height-s': cardWithOriginal('text-height-s', { height: '600' }),
      'zero-width-s': cardWithOriginal('zero-width-s', { width: 0 }),
    };
    const { transport } = serverOf((slug) => answers[slug]);
    const arts = await fetchPosterArt(Object.keys(answers), transport);
    expect([...arts.keys()]).toEqual(['kept-s']);
  });

  it('splits 31 slugs into a request of 30 and a request of 1, sent one after the other', async () => {
    const slugs = Array.from({ length: ART_BATCH_SIZE + 1 }, (_, index) => `card-${index}`);
    const { transport, requests, peakInFlightCount } = serverOf();
    const arts = await fetchPosterArt(slugs, transport);
    expect(requests.map((request) => Object.keys(request.variables).length)).toEqual([ART_BATCH_SIZE, 1]);
    expect(requests[1]?.variables).toEqual({ slug0: `card-${ART_BATCH_SIZE}` });
    expect(peakInFlightCount()).toBe(1);
    expect([...arts.keys()]).toEqual(slugs);
  });

  it('asks once for a slug listed twice', async () => {
    const { transport, requests } = serverOf();
    const arts = await fetchPosterArt(['alpha-s', 'alpha-s', 'beta-a'], transport);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.variables).toEqual({ slug0: 'alpha-s', slug1: 'beta-a' });
    expect(arts.size).toBe(2);
  });

  it('answers an empty list with an empty map and sends no request', async () => {
    const { transport, requests } = serverOf();
    expect((await fetchPosterArt([], transport)).size).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it('rejects with the API error when the server answers with errors', async () => {
    const { transport } = serverOf(cardOf, () => ({ errors: [{ message: 'card lookup failed' }] }));
    const failure = fetchPosterArt(['alpha-s'], transport);
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ failure: 'graphql' });
  });
});

describe('loadArtImage', () => {
  it('fetches the art url and turns the body into a bitmap', async () => {
    const { bitmap, fetchImage, createBitmap, host } = imageHost();
    expect(await loadArtImage(ART, host)).toBe(bitmap);
    expect(fetchImage).toHaveBeenCalledWith(ART.url);
    const blob = createBitmap.mock.calls[0]?.[0];
    expect(await blob?.text()).toBe('art');
  });

  it('rejects when the server answers with an error status and decodes nothing', async () => {
    const { createBitmap, host } = imageHost(() => Promise.resolve(new Response('no', { status: 403 })));
    await expect(loadArtImage(ART, host)).rejects.toThrow('answered 403');
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('rejects when the request fails', async () => {
    const { host } = imageHost(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(loadArtImage(ART, host)).rejects.toThrow('Failed to fetch');
  });

  it('rejects when the body cannot be decoded', async () => {
    const { createBitmap, host } = imageHost();
    createBitmap.mockRejectedValueOnce(new Error('bad image'));
    await expect(loadArtImage(ART, host)).rejects.toThrow('bad image');
  });

  it('rejects a url that is not https without requesting it', async () => {
    const { fetchImage, host } = imageHost();
    await expect(loadArtImage({ ...ART, url: 'http://cdn.senkuro.com/cards/alpha-s.webp' }, host)).rejects.toThrow('https');
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
