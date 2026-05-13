import { describe, expect, it } from 'vitest'
import { userFacingTransferNftError } from '@/lib/convex/userFacingTransferNftError'

describe('userFacingTransferNftError', () => {
  it('maps wrapped Convex dev Recipient not found to friendly copy', () => {
    const raw = `[CONVEX M(nfts:transferNFT)] [Request ID: abc] Server Error Uncaught Error: Recipient not found at handler (../convex/nfts.ts:391:26) Called by client`
    expect(userFacingTransferNftError(new Error(raw))).toBe(
      'No account uses that username. Check the spelling and try again.'
    )
  })

  it('maps plain Recipient not found', () => {
    expect(userFacingTransferNftError(new Error('Recipient not found'))).toBe(
      'No account uses that username. Check the spelling and try again.'
    )
  })

  it('returns generic copy for unknown noisy errors', () => {
    expect(
      userFacingTransferNftError(
        new Error('[CONVEX M(foo:bar)] Server Error something weird')
      )
    ).toBe('Transfer could not be completed. Please try again.')
  })
})
