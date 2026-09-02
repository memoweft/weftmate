export interface ExistingModelScope { provider: string; baseUrl: string; }

/** A retained key is valid only for exactly the same canonical endpoint scope. */
export function resolveModelSaveCredential(input: {
  prior: ExistingModelScope | undefined;
  provider: string;
  baseUrl: string;
  providedKey: string;
  storedKey: string | null;
}): string {
  if (input.prior && !input.providedKey && (input.prior.provider !== input.provider || input.prior.baseUrl !== input.baseUrl)) {
    throw new Error('更改服务地址或类型时必须重新输入 API Key');
  }
  const credential = input.providedKey || (input.prior ? input.storedKey : null);
  if (!credential) throw new Error('missing model credential');
  return credential;
}
