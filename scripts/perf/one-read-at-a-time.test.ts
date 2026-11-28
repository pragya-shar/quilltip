import { describe, expect, it } from 'vitest'
import { oneReadAtATime } from '../../lib/seo/oneReadAtATime'

/**
 * The proxy's route checks for one path (#630): at most one read in flight
 * and one queued, and never an answer read before the request arrived
 * (#613: an article hidden in between must not be seen as visible).
 */

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A stand-in backend: each read sees the state at its start, after `ms`. */
function backend(ms = 30) {
  const state = { visible: true, reads: 0, inFlight: 0, maxInFlight: 0 }
  const read = async () => {
    state.reads += 1
    state.inFlight += 1
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
    const seen = state.visible ? 'visible' : 'hidden'
    await tick(ms)
    state.inFlight -= 1
    return seen
  }
  return { state, read }
}

describe('oneReadAtATime', () => {
  it('gives no request that arrived after a hide the answer "visible"', async () => {
    const { state, read } = backend()
    const check = oneReadAtATime<string>()
    const answers: { arrivedAfterHide: boolean; answer: Promise<string> }[] = []
    const ask = () =>
      answers.push({
        arrivedAfterHide: !state.visible,
        answer: check('writer/lamp', read),
      })
    ask() // starts read A, which sees "visible"
    await tick(5)
    ask() // arrives during A: waits for the next read
    await tick(5)
    state.visible = false // the article is hidden while A runs
    await tick(5)
    ask() // arrives after the hide, during A
    ask()
    const settled = await Promise.all(
      answers.map(async (a) => ({ ...a, answer: await a.answer }))
    )
    for (const { arrivedAfterHide, answer } of settled)
      if (arrivedAfterHide) expect(answer).toBe('hidden')
    expect(settled[0]!.answer).toBe('visible')
    // Four requests, two reads: A, then one read for everyone who waited.
    expect(state.reads).toBe(2)
  })

  it('keeps at most one read in flight per key, however many requests', async () => {
    const { state, read } = backend()
    const check = oneReadAtATime<string>()
    await Promise.all(Array.from({ length: 10 }, () => check('a/b', read)))
    expect(state.reads).toBeLessThanOrEqual(2)
    expect(state.maxInFlight).toBe(1)
  })

  it('reads again for a request that arrives after the reads have settled', async () => {
    const { state, read } = backend(5)
    const check = oneReadAtATime<string>()
    await check('a/b', read)
    state.visible = false
    await expect(check('a/b', read)).resolves.toBe('hidden')
    expect(state.reads).toBe(2)
  })

  it('keeps keys apart', async () => {
    const { state, read } = backend()
    const check = oneReadAtATime<string>()
    await Promise.all([check('a/one', read), check('a/two', read)])
    expect(state.reads).toBe(2)
    expect(state.maxInFlight).toBe(2)
  })

  it('passes a failed read on to its waiters, then reads afresh', async () => {
    const check = oneReadAtATime<string>()
    let calls = 0
    const failing = async () => {
      calls += 1
      await tick(10)
      throw new Error(`read ${calls} failed`)
    }
    const first = check('a/b', failing)
    const second = check('a/b', failing)
    await expect(first).rejects.toThrow('read 1 failed')
    await expect(second).rejects.toThrow('read 2 failed')
    await expect(check('a/b', async () => 'ok')).resolves.toBe('ok')
  })
})
