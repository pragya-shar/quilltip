import { describe, expect, it } from 'vitest'
import { ONBOARDING_INTENTS } from '@/lib/copy/onboarding'

describe('onboarding copy', () => {
  it('aligns read intent with landing moves-you language', () => {
    const read = ONBOARDING_INTENTS.find((intent) => intent.id === 'read')
    expect(read?.description).toMatch(/passages that move you/)
  })

  it('does not mention testnet on intent cards', () => {
    for (const intent of ONBOARDING_INTENTS) {
      expect(intent.description).not.toMatch(/testnet/i)
      expect(intent.title).not.toMatch(/testnet/i)
    }
  })
})
