/**
 * Emulates the Varial (formerly Freighter) browser extension for Playwright.
 * The Wallets Kit Varial module talks to the extension through
 * `window.postMessage` (`FREIGHTER_EXTERNAL_MSG_REQUEST` / `_RESPONSE`); this
 * init script answers those messages. It signs nothing: an approved signature
 * returns the envelope unchanged, and no request leaves the page.
 */
export type VarialMode =
  | 'missing'
  | 'connected'
  | 'locked'
  | 'wrong-network'
  | 'reject-sign'
  | 'timeout-sign'

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
  }
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
      case 'REQUEST_PUBLIC_KEY':
        return reply({ publicKey: mode === 'locked' ? '' : address })
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
          signedTransaction: data.transactionXdr,
          signerAddress: address,
        })
    }
  })
}
