import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// Reown AppKit's only zod code: the messages between the page and its
// embedded email and social login wallet.
import { W3mFrameConstants, W3mFrameSchema } from '@reown/appkit-wallet'

/**
 * WalletConnect stays off (lib/stellar/v2/walletconnect-gate.ts) until Reown
 * AppKit is checked under the app's zod 4 override. These tests run that
 * check without a Reown project: AppKit pins zod 3.22.4 and gets 4.x.
 *
 * Result (docs/wallets.md, "WalletConnect"): the frame messages parse the
 * same, except that zod 4 refuses an object whose `z.any()` field is absent
 * and zod 3 accepted it. A wallet frame answering an RPC with no result is
 * then dropped. The kit's WalletConnect module must keep AppKit's email and
 * social login off, which keeps this frame out of the page.
 */
const version = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')).version as string

describe('Reown AppKit on the zod override', () => {
  it('AppKit asks for zod 3 and resolves to the app’s zod 4', () => {
    const appkitWallet = JSON.parse(
      readFileSync('node_modules/@reown/appkit-wallet/package.json', 'utf8')
    )
    expect(appkitWallet.dependencies.zod).toBe('3.22.4')
    expect(version('node_modules/zod/package.json')).toMatch(/^4\./)
    expect(
      existsSync('node_modules/@reown/appkit-wallet/node_modules/zod')
    ).toBe(false)
  })

  it('parses frame and app messages as zod 3 did', () => {
    const ready = W3mFrameSchema.frameEvent.safeParse({
      id: '1',
      type: W3mFrameConstants.FRAME_READY,
      payload: { version: '1.8.21' },
    })
    expect(ready.success).toBe(true)

    const connected = W3mFrameSchema.frameEvent.safeParse({
      type: W3mFrameConstants.FRAME_IS_CONNECTED_SUCCESS,
      payload: { isConnected: true },
      extra: 'dropped',
    })
    expect(connected).toMatchObject({
      success: true,
      data: {
        type: W3mFrameConstants.FRAME_IS_CONNECTED_SUCCESS,
        payload: { isConnected: true },
      },
    })
    expect(connected.data).not.toHaveProperty('extra')

    const theme = W3mFrameSchema.appEvent.safeParse({
      type: W3mFrameConstants.APP_SYNC_THEME,
      payload: { themeMode: 'light', themeVariables: { '--w3m-z-index': 9 } },
    })
    expect(theme.success).toBe(true)

    const wrong = W3mFrameSchema.frameEvent.safeParse({
      type: W3mFrameConstants.FRAME_IS_CONNECTED_SUCCESS,
      payload: { isConnected: 'yes' },
    })
    expect(wrong.success).toBe(false)
  })

  it('differs from zod 3: an RPC answer with no payload is refused', () => {
    const answered = W3mFrameSchema.frameEvent.safeParse({
      type: W3mFrameConstants.FRAME_RPC_REQUEST_SUCCESS,
      payload: '0x1',
    })
    expect(answered.success).toBe(true)
    // zod 3.22.4 accepted this message; AppKit would wait for it forever.
    const empty = W3mFrameSchema.frameEvent.safeParse({
      type: W3mFrameConstants.FRAME_RPC_REQUEST_SUCCESS,
    })
    expect(empty.success).toBe(false)
  })
})
