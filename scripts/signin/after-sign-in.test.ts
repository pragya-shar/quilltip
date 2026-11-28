import { describe, expect, it, vi } from 'vitest'
import {
  AFTER_SIGN_IN_MAX_MS,
  registerAfterSignIn,
  runAfterSignIn,
  type AfterSignInStep,
} from '@/lib/auth/afterSignIn'

describe('steps after sign-in are bounded and never block', () => {
  it('collects what the steps say, in order, skipping silence', async () => {
    const said = await runAfterSignIn([
      { name: 'a', run: () => 'First.' },
      { name: 'b', run: async () => null },
      { name: 'c', run: async () => 'Second.' },
      { name: 'd', run: () => '   ' },
    ])
    expect(said).toEqual(['First.', 'Second.'])
  })

  it('leaves a slow step behind at its bound and skips a failing one', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = runAfterSignIn([
      {
        name: 'slow',
        timeoutMs: 200,
        run: () => new Promise<string>(() => {}),
      },
      { name: 'never', run: () => new Promise<string>(() => {}) },
      {
        name: 'fail',
        run: async () => {
          throw new Error('x')
        },
      },
      { name: 'ok', run: async () => 'Done.' },
    ])
    await vi.advanceTimersByTimeAsync(AFTER_SIGN_IN_MAX_MS)
    await expect(run).resolves.toEqual(['Done.'])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    warn.mockRestore()
    error.mockRestore()
  })

  it('never lets a step ask for more than the maximum', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let settled = false
    const greedy: AfterSignInStep = {
      name: 'greedy',
      timeoutMs: 60_000,
      run: () => new Promise<string>(() => {}),
    }
    void runAfterSignIn([greedy]).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(AFTER_SIGN_IN_MAX_MS)
    expect(settled).toBe(true)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('registers by name, and removes only its own step', async () => {
    const remove = registerAfterSignIn({ name: 'x', run: () => 'One.' })
    const replace = registerAfterSignIn({ name: 'x', run: () => 'Two.' })
    expect(await runAfterSignIn()).toEqual(['Two.'])
    remove()
    expect(await runAfterSignIn()).toEqual(['Two.'])
    replace()
    expect(await runAfterSignIn()).toEqual([])
  })
})
