import { describe, expect, test } from 'vitest'
import { draftToShow } from '../../components/today/draftRow'
import { paymentsStore, type PaymentsState } from '../../lib/payments/store'

const PAIR = 'user1|session1'
const DRAFT = {
  id: 'draft1',
  title: 'The year I stopped buying books',
  words: 812,
}

/** The store as the payments shell leaves it, signed in, with `patch`. */
const signedIn = (patch: Partial<PaymentsState>): PaymentsState => ({
  ...paymentsStore.get(),
  auth: 'signed-in',
  ...patch,
})

describe('the "Your draft" row', () => {
  test('shows the draft while the store is bound to the token’s session', () => {
    const bound = signedIn({ owner: PAIR, session: PAIR, engine: 'ready' })
    expect(draftToShow(bound, DRAFT)).toEqual(DRAFT)
    expect(draftToShow(bound, { ...DRAFT, title: '' })?.title).toBe(
      'Untitled draft'
    )
    expect(draftToShow(bound, null)).toBeNull()
    expect(draftToShow(bound, undefined)).toBeUndefined()
  })

  test('shows nothing yet while the store is not bound, even with an answer', () => {
    // Not claimed yet, or claimed for another session than the token's.
    for (const unbound of [
      signedIn({ owner: null, session: PAIR, engine: 'loading' }),
      signedIn({ owner: 'user2|session2', session: PAIR, engine: 'ready' }),
      signedIn({ owner: PAIR, session: null, engine: 'ready' }),
    ])
      expect(draftToShow(unbound, DRAFT)).toBeUndefined()
  })

  test('shows no row when the payments engine failed and never binds', () => {
    const failed = signedIn({ owner: null, session: PAIR, engine: 'failed' })
    expect(draftToShow(failed, DRAFT)).toBeNull()
  })
})
