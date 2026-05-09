import { describe, it, expect } from 'vitest'
import {
  stellarFlowEmitter,
  type StellarFlowEvent,
} from '@/lib/stellar/stellar-flow-emitter'

describe('stellarFlowEmitter', () => {
  it('delivers events to subscribers in emit order', () => {
    const received: StellarFlowEvent[] = []
    const unsub = stellarFlowEmitter.subscribe((e) => {
      received.push(e)
    })

    stellarFlowEmitter.emit({ flow: 'tip', step: 'awaiting_signature' })
    stellarFlowEmitter.emit({ flow: 'tip', step: 'submitting' })
    stellarFlowEmitter.emit({ flow: 'tip', step: 'confirming' })

    expect(received).toEqual([
      { flow: 'tip', step: 'awaiting_signature' },
      { flow: 'tip', step: 'submitting' },
      { flow: 'tip', step: 'confirming' },
    ])

    unsub()
  })

  it('stops delivering after unsubscribe', () => {
    const received: StellarFlowEvent[] = []
    const unsub = stellarFlowEmitter.subscribe((e) => received.push(e))

    stellarFlowEmitter.emit({ flow: 'nft_mint', step: 'idle' })
    unsub()
    stellarFlowEmitter.emit({ flow: 'tip', step: 'confirming' })

    expect(received).toEqual([{ flow: 'nft_mint', step: 'idle' }])
  })
})
