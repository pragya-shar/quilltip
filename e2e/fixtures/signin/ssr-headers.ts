// next/headers for the server render outside Next.js: no request headers,
// so no CSP nonce.
export async function headers(): Promise<Headers> {
  return new Headers()
}
