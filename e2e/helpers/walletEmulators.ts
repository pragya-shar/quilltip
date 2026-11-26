/**
 * Fake Stellar wallet providers for Playwright, one per wallet QuillTip
 * offers besides Varial (see `varialEmulator.ts`). Each installs the object
 * the wallet's browser extension injects, with the methods and return shapes
 * its Wallets Kit 2.8 module calls (`docs/wallets.md`), so the real kit
 * module runs unchanged. No request leaves the page.
 *
 * Signing uses the wallet fixture's throwaway testnet key
 * (`window.__fixtureWallet`). Modes:
 * - `connected`: shares the address and signs for the network it is asked.
 * - `locked`: refuses to share an address, as a locked wallet does.
 * - `wrong-network`: a wallet on Stellar mainnet. Wallets that report their
 *   network say so; the others sign for mainnet.
 * - `reject`: the reader declines every signing request.
 *
 * Error texts follow the wallet's documentation where it gives one, and are
 * otherwise representative (marked "assumed").
 */
export type EmulatedWallet = 'xbull' | 'rabet' | 'hana' | 'scopuly' | 'dcent'
export type EmulatorMode = 'connected' | 'locked' | 'wrong-network' | 'reject'

export type EmulatorOptions = { wallet: EmulatedWallet; mode: EmulatorMode }

export function installWalletEmulator({ wallet, mode }: EmulatorOptions) {
  const TESTNET = 'Test SDF Network ; September 2015'
  const PUBLIC = 'Public Global Stellar Network ; September 2015'
  type FixtureWallet = {
    address: string
    signMessage(message: string): string
    signTransactionFor(xdr: string, passphrase: string): string
  }
  const key = () =>
    (window as unknown as { __fixtureWallet: FixtureWallet }).__fixtureWallet
  const log: { method: string; network?: string }[] = []
  ;(window as unknown as { __walletRequests: typeof log }).__walletRequests =
    log
  const w = window as unknown as Record<string, unknown>

  /** The passphrase the fake signs for: the one asked, or mainnet. */
  const signingNetwork = (asked?: string) =>
    mode === 'wrong-network' ? PUBLIC : (asked ?? TESTNET)
  const declined = () => mode === 'reject'

  switch (wallet) {
    case 'xbull': {
      // window.xBullSDK, used by @creit.tech/xbull-wallet-connect when the
      // extension is installed. Answers carry `error` instead of throwing.
      const error = (message: string) => ({ error: { code: -1, message } })
      w.xBullSDK = {
        async getAddress() {
          log.push({ method: 'getAddress' })
          if (mode === 'locked') return error('xBull is locked') // assumed
          return { address: key().address }
        },
        async signTransaction(params: {
          xdr: string
          opts?: { networkPassphrase?: string }
        }) {
          log.push({
            method: 'signTransaction',
            network: params.opts?.networkPassphrase,
          })
          if (declined()) return error('Request rejected from the wallet')
          return {
            signedTxXdr: key().signTransactionFor(
              params.xdr,
              signingNetwork(params.opts?.networkPassphrase)
            ),
          }
        },
        async signMessage(message: string) {
          log.push({ method: 'signMessage' })
          if (declined()) return error('Request rejected from the wallet')
          return {
            signedMessage: key().signMessage(message),
            signerAddress: key().address,
          }
        },
      }
      return
    }
    case 'rabet': {
      // window.rabet: connect() and sign(xdr, 'mainnet' | 'testnet').
      w.rabet = {
        async connect() {
          log.push({ method: 'connect' })
          if (mode === 'locked') throw new Error('Rabet is locked') // assumed
          return { publicKey: key().address }
        },
        async sign(xdr: string, network: 'mainnet' | 'testnet') {
          log.push({ method: 'sign', network })
          if (declined()) throw new Error('User rejected the request.') // assumed
          const passphrase = network === 'mainnet' ? PUBLIC : TESTNET
          return {
            xdr: key().signTransactionFor(xdr, signingNetwork(passphrase)),
          }
        },
      }
      return
    }
    case 'hana': {
      // window.hanaWallet.stellar: methods resolve with bare strings.
      w.hanaWallet = {
        stellar: {
          async getPublicKey() {
            log.push({ method: 'getPublicKey' })
            if (mode === 'locked') throw new Error('Wallet is locked') // assumed
            return key().address
          },
          async signTransaction(params: {
            xdr: string
            networkPassphrase?: string
          }) {
            log.push({
              method: 'signTransaction',
              network: params.networkPassphrase,
            })
            if (declined()) throw new Error('User rejected the request') // assumed
            return key().signTransactionFor(
              params.xdr,
              signingNetwork(params.networkPassphrase)
            )
          },
          async signMessage(params: { message: string }) {
            log.push({ method: 'signMessage' })
            if (declined()) throw new Error('User rejected the request') // assumed
            return key().signMessage(params.message)
          },
          async signAuthEntry() {
            throw new Error('not used')
          },
        },
      }
      return
    }
    case 'scopuly': {
      // window.scopuly (Scopuly provider API): results carry `error`.
      const refused = {
        error: { code: -4, message: 'User rejected the request' },
      }
      w.scopuly = {
        isScopuly: true,
        platform: 'extension',
        async requestAccess() {
          log.push({ method: 'requestAccess' })
          if (mode === 'locked') {
            return { error: { code: -1, message: 'Scopuly is locked' } } // assumed
          }
          return { address: key().address }
        },
        async getAddress() {
          return { address: key().address }
        },
        async getPublicKey() {
          return key().address
        },
        async getNetwork() {
          log.push({ method: 'getNetwork' })
          return mode === 'wrong-network'
            ? { network: 'PUBLIC', networkPassphrase: PUBLIC }
            : { network: 'TESTNET', networkPassphrase: TESTNET }
        },
        async signTransaction(
          xdr: string,
          opts?: { networkPassphrase?: string }
        ) {
          log.push({
            method: 'signTransaction',
            network: opts?.networkPassphrase,
          })
          if (declined()) return refused
          return {
            signedTxXdr: key().signTransactionFor(
              xdr,
              signingNetwork(opts?.networkPassphrase)
            ),
            signerAddress: key().address,
          }
        },
        async signMessage(message: string) {
          log.push({ method: 'signMessage' })
          if (declined()) return refused
          return {
            signedMessage: key().signMessage(message),
            signerAddress: key().address,
          }
        },
        onChange: () => () => {},
        async disconnect() {},
      }
      window.dispatchEvent(new Event('scopuly#initialized'))
      return
    }
    case 'dcent': {
      // window.dcentStellarProvider, announced by window.stellar.provider.
      const refused = {
        error: { code: -4, message: 'User rejected the request' }, // assumed
      }
      w.stellar = { provider: 'dcent', platform: 'extension' }
      w.dcentStellarProvider = {
        async isConnected() {
          return { isConnected: true }
        },
        async requestAccess() {
          log.push({ method: 'requestAccess' })
          return {}
        },
        async getAddress() {
          if (mode === 'locked') return {}
          return { address: key().address }
        },
        async getNetwork() {
          log.push({ method: 'getNetwork' })
          return mode === 'wrong-network'
            ? { network: 'PUBLIC', networkPassphrase: PUBLIC }
            : { network: 'TESTNET', networkPassphrase: TESTNET }
        },
        async signTransaction(
          xdr: string,
          opts?: { networkPassphrase?: string }
        ) {
          log.push({
            method: 'signTransaction',
            network: opts?.networkPassphrase,
          })
          if (declined()) return refused
          return {
            signedTxXdr: key().signTransactionFor(
              xdr,
              signingNetwork(opts?.networkPassphrase)
            ),
            signerAddress: key().address,
          }
        },
        async signMessage(message: string) {
          log.push({ method: 'signMessage' })
          if (declined()) return refused
          return {
            signedMessage: key().signMessage(message),
            signerAddress: key().address,
          }
        },
      }
      window.dispatchEvent(new Event('dcent#initialized'))
      return
    }
  }
}
