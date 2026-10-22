export const TOKEN_REQUEST = 'SENKURO_GET_TOKEN';

export interface TokenRequest {
  type: typeof TOKEN_REQUEST;
}

export interface TokenResponse {
  token: string | null;
}

export const isTokenRequest = (message: unknown): message is TokenRequest => (message as Partial<TokenRequest> | null)?.type === TOKEN_REQUEST;
