import { describe, expect, it } from 'vitest'

import { DUE_AGE_MS, DUE_AMOUNT } from '../../convex/lib/chain/settler'
import { RESULT_COPY } from '../../lib/copy/payment-states'
import { TAB_HISTORY, TAB_TIP } from '../../lib/copy/tab'

/**
 * The tab tip copy states when a tip settles from the settler's own rule (a
 * pair is due at DUE_AMOUNT unsettled or DUE_AGE_MS after its oldest tip),
 * never a fixed wait: a pair over the amount settles within one run (#547).
 */
describe('tab tip settlement copy', () => {
  const xlm = `${Number(DUE_AMOUNT / BigInt(10_000_000))} XLM`
  const hours = `${DUE_AGE_MS / 3_600_000} hours`
  const texts = {
    'quick tip note': TAB_TIP.noPrompt,
    'accepted result': RESULT_COPY.accepted.detail,
    'history row': TAB_HISTORY.accepted,
  }

  for (const [where, text] of Object.entries(texts)) {
    it(`${where} names both settlement triggers and no fixed wait`, () => {
      expect(text).toContain(xlm)
      expect(text).toContain(hours)
      expect(text).not.toMatch(/usually|within about/i)
    })
  }
})
