/**
 * A stand-in for xBull's web wallet (https://wallet.xbull.app/connect), for
 * the wallet fixture. Playwright serves it at that address in the window the
 * xBull module opens, so the real `@creit.tech/xbull-wallet-connect` bridge
 * runs unchanged: the same NaCl box handshake, then one encrypted request and
 * one encrypted answer over `postMessage`. Nothing leaves the browser.
 *
 * The test sets `window.__xbullWeb` before this script runs:
 * - `secret`: a throwaway testnet secret key, the same in every window, so
 *   the address stays the same between connect and sign.
 * - `mode`: `approve`, `reject` (the wallet answers "rejected"), `close` (the
 *   reader closes the window), or `wrong-network` (signs for mainnet).
 */
import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk'

type Mode = 'approve' | 'reject' | 'close' | 'wrong-network'
declare global {
  interface Window {
    __xbullWeb: { secret: string; mode: Mode }
    __xbullWebRequests: string[]
  }
}

const { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } = naclUtil
const { secret, mode } = window.__xbullWeb
const account = Keypair.fromSecret(secret)
const params = new URLSearchParams(location.search)
const dappKey = decodeBase64(params.get('public') ?? '')
const session = params.get('session') ?? ''
const box = nacl.box.keyPair()
const opener = window.opener as Window | null

function encrypt(data: unknown) {
  const nonce = nacl.randomBytes(24)
  const sealed = nacl.box(
    decodeUTF8(JSON.stringify(data)),
    nonce,
    dappKey,
    box.secretKey
  )
  return { message: encodeBase64(sealed), oneTimeCode: encodeBase64(nonce) }
}

function decrypt(message: string, oneTimeCode: string) {
  const opened = nacl.box.open(
    decodeBase64(message),
    decodeBase64(oneTimeCode),
    dappKey,
    box.secretKey
  )
  if (!opened) throw new Error('Could not decrypt the request')
  return JSON.parse(encodeUTF8(opened))
}

function reply(type: string, data: unknown) {
  if (mode === 'close') {
    window.close()
    return
  }
  if (mode === 'reject') {
    opener?.postMessage({ type, success: false }, '*')
    return
  }
  opener?.postMessage({ type, success: true, ...encrypt(data) }, '*')
}

window.addEventListener('message', (event) => {
  const { type, message, oneTimeCode } = event.data ?? {}
  if (typeof type !== 'string' || !message) return
  const request = decrypt(message, oneTimeCode)
  document.body.dataset.request = type
  if (type === 'XBULL_CONNECT') {
    reply('XBULL_CONNECT_RESPONSE', { publicKey: account.publicKey() })
  } else if (type === 'XBULL_SIGN') {
    const passphrase =
      mode === 'wrong-network' ? Networks.PUBLIC : request.network
    const tx = TransactionBuilder.fromXDR(request.xdr, passphrase)
    tx.sign(account)
    reply('XBULL_SIGN_RESPONSE', { xdr: tx.toXDR() })
  } else if (type === 'XBULL_SIGN_MESSAGE') {
    reply('XBULL_SIGN_MESSAGE_RESPONSE', {
      message: request.message,
      fullMessage: request.message,
      signedMessage: encodeBase64(account.signMessage(request.message)),
      signerAddress: account.publicKey(),
    })
  }
})

// The handshake: the session the page was opened with, sealed for the page.
opener?.postMessage(
  {
    type: 'XBULL_INITIAL_RESPONSE',
    publicKey: encodeBase64(box.publicKey),
    ...encrypt({ providedSession: session }),
  },
  '*'
)
document.body.textContent = 'xBull test wallet'
