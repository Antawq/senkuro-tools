const STREAMED = /multipart|event-stream/;

export const requestUrl = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as { url?: string } | null)?.url ?? '';
};

export const isGraphqlRequest = (input: unknown, base: string): boolean => {
  try {
    return new URL(requestUrl(input), base).pathname.endsWith('/graphql');
  } catch {
    return false;
  }
};

export const isStreamed = (response: Response): boolean => STREAMED.test(response.headers.get('content-type') ?? '');
