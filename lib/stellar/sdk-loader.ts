let stellarSdkPromise: Promise<typeof import('@stellar/stellar-sdk')> | null =
  null

export function loadStellarSdk(): Promise<
  typeof import('@stellar/stellar-sdk')
> {
  stellarSdkPromise ??= import('@stellar/stellar-sdk')
  return stellarSdkPromise
}
