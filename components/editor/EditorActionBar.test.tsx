/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Editor } from '@tiptap/react'
import { EditorActionBar } from '@/components/editor/EditorActionBar'

function makeStubEditor(): Editor {
  return {
    can: () => ({
      undo: () => false,
      redo: () => false,
    }),
    chain: () => ({
      focus: () => ({
        undo: () => ({ run: () => true }),
        redo: () => ({ run: () => true }),
      }),
    }),
    getText: () => '',
  } as unknown as Editor
}

const noop = () => {}

const baseProps = {
  editor: makeStubEditor(),
  onBack: noop,
  onSave: noop,
  onPublish: noop,
  isSaving: false,
  error: null,
  isPublished: false,
  isPublishing: false,
  canPublish: true,
}

describe('EditorActionBar autosave status', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows Saving... in the status line while isSaving', () => {
    render(<EditorActionBar {...baseProps} isSaving />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Saving...')
  })

  it('shows relative saved label when lastSavedAt is set and not dirty', () => {
    const t = new Date('2020-01-01T12:00:00.000Z')
    render(
      <EditorActionBar
        {...baseProps}
        lastSavedAt={t}
        hasUnsavedChanges={false}
      />
    )
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/^Saved .+ ago$/)
  })

  it('increments relative tick on interval while showing saved time', () => {
    vi.useFakeTimers()
    const t = new Date(Date.now() - 60_000)
    render(
      <EditorActionBar
        {...baseProps}
        lastSavedAt={t}
        hasUnsavedChanges={false}
      />
    )
    const status = screen.getByRole('status')
    expect(status.getAttribute('data-relative-tick')).toBe('0')
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByRole('status').getAttribute('data-relative-tick')).toBe(
      '1'
    )
  })

  it('shows error state when save failed', () => {
    render(
      <EditorActionBar {...baseProps} error="Network error" hasUnsavedChanges />
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent("Couldn't save")
    expect(status).toHaveAttribute('title', 'Network error')
  })

  it('shows Unsaved changes when dirty and not saving', () => {
    render(<EditorActionBar {...baseProps} hasUnsavedChanges />)
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  })

  it('shows Not saved yet when no save and not dirty', () => {
    render(<EditorActionBar {...baseProps} />)
    expect(screen.getByRole('status')).toHaveTextContent('Not saved yet')
  })
})
