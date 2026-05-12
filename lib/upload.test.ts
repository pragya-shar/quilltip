/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressImage, isAbortError } from './upload'

type ImageHandlers = {
  onload: (() => void) | null
  onerror: (() => void) | null
  src: string
  width: number
  height: number
}

const liveImages: ImageHandlers[] = []

function lastImage(): ImageHandlers {
  const img = liveImages[liveImages.length - 1]
  if (!img) throw new Error('No Image instance has been created yet')
  return img
}

class StubImage implements ImageHandlers {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  width = 100
  height = 100
  private _src = ''

  constructor() {
    liveImages.push(this)
  }

  get src(): string {
    return this._src
  }

  set src(value: string) {
    this._src = value
  }
}

const createObjectURL = vi.fn(() => 'blob:mock-url')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  liveImages.length = 0
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()

  vi.stubGlobal('Image', StubImage)
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  })

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback
  ) {
    callback(new Blob(['x'], { type: 'image/png' }))
  } as HTMLCanvasElement['toBlob'])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function makeFile(): File {
  return new File(['x'], 'test.png', { type: 'image/png' })
}

describe('isAbortError', () => {
  it('returns true for DOMException with name AbortError', () => {
    expect(isAbortError(new DOMException('canceled', 'AbortError'))).toBe(true)
  })

  it('returns false for plain errors', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})

describe('compressImage', () => {
  it('rejects when the image fails to decode', async () => {
    const promise = compressImage(makeFile())
    await Promise.resolve()
    lastImage().onerror?.()

    await expect(promise).rejects.toThrow(
      /could not read image|corrupt|unsupported/i
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('revokes the object URL on the success path too', async () => {
    const promise = compressImage(makeFile())
    await Promise.resolve()
    lastImage().onload?.()

    await expect(promise).resolves.toBeInstanceOf(File)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      compressImage(makeFile(), 1200, 0.8, controller.signal)
    ).rejects.toSatisfy(isAbortError)
  })

  it('rejects with AbortError when the signal aborts during decode', async () => {
    const controller = new AbortController()
    const promise = compressImage(makeFile(), 1200, 0.8, controller.signal)
    await Promise.resolve()

    controller.abort()

    await expect(promise).rejects.toSatisfy(isAbortError)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('rejects on the 30s timeout if decode never resolves', async () => {
    vi.useFakeTimers()
    try {
      const promise = compressImage(makeFile())
      const assertion = expect(promise).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    } finally {
      vi.useRealTimers()
    }
  })
})
