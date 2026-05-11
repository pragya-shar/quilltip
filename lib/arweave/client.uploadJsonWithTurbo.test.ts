import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const uploadMock = vi.fn()

vi.mock('@ardrive/turbo-sdk/node', () => ({
  TurboFactory: {
    authenticated: () => ({
      upload: uploadMock,
    }),
  },
  ArweaveSigner: class {
    constructor(_jwk: unknown) {}
  },
}))

describe('uploadJsonWithTurbo', () => {
  beforeEach(() => {
    uploadMock.mockReset()
    uploadMock.mockResolvedValue({ id: 'abcdefghijklmnopqrstuvwxyz0123456789AB' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns arweave URL on success', async () => {
    const { uploadJsonWithTurbo } = await import('./client')
    const jwk = {
      kty: 'RSA',
      n: 'x'.repeat(340),
      e: 'AQAB',
      d: 'd',
      p: 'p',
      q: 'q',
      dp: 'dp',
      dq: 'dq',
      qi: 'qi',
    }

    const result = await uploadJsonWithTurbo(
      { hello: 'world' },
      jwk as never,
      [{ name: 'Article-Id', value: 'test123' }]
    )

    expect(result.success).toBe(true)
    expect(result.url).toBe(
      'https://arweave.net/abcdefghijklmnopqrstuvwxyz0123456789AB'
    )
    expect(result.txId).toBe('abcdefghijklmnopqrstuvwxyz0123456789AB')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('returns failure when upload throws', async () => {
    uploadMock.mockRejectedValueOnce(new Error('Turbo unavailable'))
    const { uploadJsonWithTurbo } = await import('./client')
    const jwk = {
      kty: 'RSA',
      n: 'x'.repeat(340),
      e: 'AQAB',
      d: 'd',
      p: 'p',
      q: 'q',
      dp: 'dp',
      dq: 'dq',
      qi: 'qi',
    }

    const result = await uploadJsonWithTurbo({}, jwk as never, [])

    expect(result.success).toBe(false)
    expect(result.error).toBe('Turbo unavailable')
  })
})
