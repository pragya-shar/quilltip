/**
 * Emulates the Varial (formerly Freighter) browser extension for Playwright.
 * The Wallets Kit Varial module talks to the extension through
 * `window.postMessage` (`FREIGHTER_EXTERNAL_MSG_REQUEST` / `_RESPONSE`); this
 * init script answers those messages. No request leaves the page.
 *
 * Signing: when the page provides `window.__fixtureWallet` (the wallet
 * fixture's throwaway testnet key), messages and transactions are signed with
 * it, and `address` is ignored. Otherwise an approved transaction is returned
 * unchanged.
 */
export type VarialMode =
  | 'missing'
  | 'connected'
  | 'locked'
  | 'wrong-network'
  | 'reject-sign'
  | 'timeout-sign'
  /** Signs transactions but reports that it cannot sign messages. */
  | 'no-message-signing'
  /**
   * Locked, as the real extension behaves: the site is allowed, but the
   * access request waits behind a password prompt and never answers, and
   * the address read without a prompt is empty.
   */
  | 'locked-prompt'

export type VarialEmulatorOptions = { mode: VarialMode; address: string }

export function installVarialEmulator({
  mode,
  address,
}: VarialEmulatorOptions) {
  const TESTNET = 'Test SDF Network ; September 2015'
  const PUBLIC = 'Public Global Stellar Network ; September 2015'
  type Request = {
    source?: string
    messageId?: number
    type?: string
    networkPassphrase?: string
    transactionXdr?: string
    blob?: string
  }
  type FixtureWallet = {
    address: string
    signMessage(message: string): string
    signTransaction(xdr: string): string
  }
  const fixture = () =>
    (window as unknown as { __fixtureWallet?: FixtureWallet }).__fixtureWallet
  const accountAddress = () => fixture()?.address ?? address
  const log: Request[] = []
  ;(window as unknown as { __varialRequests: Request[] }).__varialRequests = log
  if (mode === 'missing') return
  ;(window as unknown as { freighter: boolean }).freighter = true
  window.addEventListener('message', (event) => {
    const data = event.data as Request
    if (
      event.source !== window ||
      data?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST'
    )
      return
    log.push(data)
    const reply = (body: Record<string, unknown>) =>
      window.postMessage(
        {
          source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
          messagedId: data.messageId,
          ...body,
        },
        window.location.origin
      )
    switch (data.type) {
      case 'REQUEST_CONNECTION_STATUS':
        return reply({ isConnected: true })
      case 'REQUEST_ALLOWED_STATUS':
        return reply({ isAllowed: mode !== 'locked' })
      case 'REQUEST_ACCESS':
        if (mode === 'locked-prompt') return
        return reply({ publicKey: mode === 'locked' ? '' : accountAddress() })
      case 'REQUEST_PUBLIC_KEY':
        if (mode === 'locked-prompt') return reply({ publicKey: '' })
        return reply({ publicKey: mode === 'locked' ? '' : accountAddress() })
      case 'REQUEST_NETWORK_DETAILS':
        return reply({
          networkDetails: {
            network: mode === 'wrong-network' ? 'PUBLIC' : 'TESTNET',
            networkName: mode === 'wrong-network' ? 'Main Net' : 'Test Net',
            networkUrl: '',
            networkPassphrase: mode === 'wrong-network' ? PUBLIC : TESTNET,
          },
        })
      case 'SUBMIT_TRANSACTION':
        if (mode === 'timeout-sign') return
        if (mode === 'reject-sign')
          return reply({
            apiError: { code: -4, message: 'User declined access' },
          })
        return reply({
          signedTransaction: fixture()
            ? fixture()!.signTransaction(data.transactionXdr!)
            : data.transactionXdr,
          signerAddress: accountAddress(),
        })
      case 'SUBMIT_BLOB':
        if (mode === 'timeout-sign') return
        if (mode === 'reject-sign')
          return reply({
            apiError: { code: -4, message: 'User declined access' },
          })
        if (mode === 'no-message-signing')
          return reply({
            apiError: {
              code: -3,
              message: 'Varial does not support the "signMessage" function',
            },
          })
        return reply({
          signedBlob: fixture()?.signMessage(data.blob ?? '') ?? '',
          signerAddress: accountAddress(),
        })
    }
  })
}
