/**
 * A test-only Stellar wallet for Playwright runs against a real testnet
 * backend. It installs the object the xBull extension injects
 * (`window.xBullSDK`), so the app's real Wallets Kit module runs unchanged,
 * and signs in Node with a test account's secret: the secret never enters
 * the page. It refuses every network but Stellar testnet.
 *
 * Test tooling only: nothing in the app imports it, so it is never bundled.
 * Used by the guarded real-run suite (`e2e/real-run/`), which CI never runs.
 */
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import type { BrowserContext } from '@playwright/test'

export type TestnetWallet = { address: string; signed: () => number }

/** Signs a transaction envelope for testnet only. */
export function signForTestnet(
  keypair: Keypair,
  xdr: string,
  passphrase: string | undefined
): string {
  if ((passphrase ?? Networks.TESTNET) !== Networks.TESTNET)
    throw new Error('The test wallet signs for Stellar testnet only.')
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET)
  if (tx.networkPassphrase !== Networks.TESTNET)
    throw new Error('The test wallet signs for Stellar testnet only.')
  tx.sign(keypair)
  return tx.toXDR()
}

export async function installTestnetWallet(
  context: BrowserContext,
  secret: string
): Promise<TestnetWallet> {
  if (!secret) throw new Error('A test account secret is required.')
  const keypair = Keypair.fromSecret(secret)
  let count = 0
  await context.exposeBinding(
    '__qtTestnetWalletSign',
    (_source, xdr: string, passphrase: string | undefined) => {
      count++
      return signForTestnet(keypair, xdr, passphrase)
    }
  )
  await context.exposeBinding(
    '__qtTestnetWalletMessage',
    (_source, message: string) => {
      count++
      return Buffer.from(keypair.signMessage(message)).toString('base64')
    }
  )
  await context.addInitScript(
    ({ address, testnet }) => {
      type Signer = (xdr: string, passphrase?: string) => Promise<string>
      const w = window as unknown as Record<string, unknown> & {
        __qtTestnetWalletSign: Signer
        __qtTestnetWalletMessage: (message: string) => Promise<string>
      }
      const fail = (message: string) => ({ error: { code: -1, message } })
      w.xBullSDK = {
        async getAddress() {
          return { address }
        },
        async signTransaction(params: {
          xdr: string
          opts?: { networkPassphrase?: string }
        }) {
          const passphrase = params.opts?.networkPassphrase ?? testnet
          if (passphrase !== testnet) return fail('Testnet only')
          try {
            return {
              signedTxXdr: await w.__qtTestnetWalletSign(
                params.xdr,
                passphrase
              ),
            }
          } catch (error) {
            return fail(String(error))
          }
        },
        async signMessage(message: string) {
          return {
            signedMessage: await w.__qtTestnetWalletMessage(message),
            signerAddress: address,
          }
        },
      }
    },
    { address: keypair.publicKey(), testnet: Networks.TESTNET }
  )
  return { address: keypair.publicKey(), signed: () => count }
}
