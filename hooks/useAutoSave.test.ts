/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { useAutoSave } from './useAutoSave'
import { DRAFT_BACKUP_STORAGE_KEY } from '@/lib/draftBackup'

const mockSaveDraft = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useMutation: () => mockSaveDraft,
}))

const sampleContent: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveDraft.mockResolvedValue('article-123')
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets isSaving during saveNow and lastSavedAt only after success', async () => {
    let resolveSave: (id: string) => void = () => {}
    mockSaveDraft.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveSave = resolve
        })
    )

    const { result } = renderHook(() =>
      useAutoSave({
        content: sampleContent,
        title: 'My draft',
        enabled: false,
      })
    )

    expect(result.current.isSaving).toBe(false)
    expect(result.current.lastSavedAt).toBeNull()

    let savePromise: Promise<void>
    act(() => {
      savePromise = result.current.saveNow()
    })

    await waitFor(() => {
      expect(result.current.isSaving).toBe(true)
    })
    expect(result.current.lastSavedAt).toBeNull()

    await act(async () => {
      resolveSave('article-123')
      await savePromise!
    })

    expect(result.current.isSaving).toBe(false)
    expect(result.current.lastSavedAt).toBeInstanceOf(Date)
    expect(result.current.error).toBeNull()
  })

  it('sets error on failure and does not update lastSavedAt', async () => {
    const previousSavedAt = new Date('2020-01-01T12:00:00.000Z')
    mockSaveDraft.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useAutoSave({
        content: sampleContent,
        title: 'My draft',
        enabled: false,
      })
    )

    await act(async () => {
      await result.current.saveNow()
    })

    expect(result.current.isSaving).toBe(false)
    expect(result.current.error?.message).toBe('Network error')
    expect(result.current.lastSavedAt).toBeNull()

    mockSaveDraft.mockResolvedValue('article-123')

    await act(async () => {
      await result.current.saveNow()
    })

    expect(result.current.lastSavedAt).not.toEqual(previousSavedAt)
    expect(result.current.error).toBeNull()
  })

  it('rejects with timeout message when save exceeds SAVE_DRAFT_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    mockSaveDraft.mockImplementation(() => new Promise<string>(() => {}))

    const { result } = renderHook(() =>
      useAutoSave({
        content: sampleContent,
        title: 'My draft',
        enabled: false,
      })
    )

    let savePromise: Promise<void>
    act(() => {
      savePromise = result.current.saveNow()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      await savePromise!
    })

    expect(result.current.isSaving).toBe(false)
    expect(result.current.error?.message).toBe(
      'Save timed out. Check your connection.'
    )
    expect(result.current.lastSavedAt).toBeNull()
  })

  it('calls onSaveSuccess only after a successful save', async () => {
    const onSaveSuccess = vi.fn()
    mockSaveDraft.mockResolvedValue('article-456')

    const { result } = renderHook(() =>
      useAutoSave({
        content: sampleContent,
        title: 'My draft',
        enabled: false,
        onSaveSuccess,
      })
    )

    await act(async () => {
      await result.current.saveNow()
    })

    expect(onSaveSuccess).toHaveBeenCalledTimes(1)
    expect(onSaveSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'article-456',
        title: 'My draft',
      })
    )
  })

  it('does not remove local draft backup on mount', () => {
    localStorage.setItem(
      DRAFT_BACKUP_STORAGE_KEY,
      JSON.stringify({
        title: 'Kept',
        content: sampleContent,
        savedAt: Date.now(),
      })
    )

    renderHook(() =>
      useAutoSave({
        content: sampleContent,
        title: 'My draft',
        enabled: false,
      })
    )

    expect(localStorage.getItem(DRAFT_BACKUP_STORAGE_KEY)).not.toBeNull()
  })

  it('debounces save when only writerNotes changes', async () => {
    vi.useFakeTimers()
    mockSaveDraft.mockResolvedValue('article-123')

    const { rerender } = renderHook(
      ({ writerNotes }: { writerNotes: string }) =>
        useAutoSave({
          content: null,
          title: '',
          writerNotes,
          enabled: true,
        }),
      { initialProps: { writerNotes: '' } }
    )

    rerender({ writerNotes: 'Planning note' })

    expect(mockSaveDraft).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(mockSaveDraft).toHaveBeenCalledTimes(1)
    expect(mockSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        writerNotes: 'Planning note',
        title: 'Untitled',
      })
    )
  })

  it('calls onSaveError when save fails', async () => {
    const onSaveError = vi.fn()
    mockSaveDraft.mockRejectedValue(new Error('Offline'))

    const { result } = renderHook(() =>
      useAutoSave({
        content: sampleContent,
        title: 'My draft',
        enabled: false,
        onSaveError,
      })
    )

    await act(async () => {
      await result.current.saveNow()
    })

    expect(onSaveError).toHaveBeenCalledTimes(1)
    const errorArg = onSaveError.mock.calls[0]?.[0]
    expect(errorArg).toBeInstanceOf(Error)
    expect((errorArg as Error).message).toBe('Offline')
  })
})
