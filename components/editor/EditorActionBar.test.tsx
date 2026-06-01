/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Editor } from '@tiptap/react'
import { EditorActionBar } from '@/components/editor/EditorActionBar'
import { AUTO_SAVE_GUIDANCE } from '@/lib/autosave'

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
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent('Saving...')
    }
  })

  it('shows Saving... in status and on Save button while isSaving with unsaved edits', () => {
    render(<EditorActionBar {...baseProps} isSaving hasUnsavedChanges />)
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent('Saving...')
    }
    const saveButtons = screen.getAllByRole('button', { name: 'Saving...' })
    expect(saveButtons.length).toBeGreaterThanOrEqual(1)
    for (const button of saveButtons) {
      expect(button).toBeDisabled()
    }
  })

  it('shows Could not save with destructive Draft pill when error and dirty', () => {
    const { container } = render(
      <EditorActionBar {...baseProps} error="Network error" hasUnsavedChanges />
    )
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent("Couldn't save")
    }
    expect(container.querySelector('.bg-destructive\\/15')).not.toBeNull()
    expect(screen.getByText('Save failed')).toBeInTheDocument()
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
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status.textContent).toMatch(/^Saved .+ ago$/)
    }
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
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status.getAttribute('data-relative-tick')).toBe('0')
    }
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    const statusesAfter = screen.getAllByRole('status')
    for (const status of statusesAfter) {
      expect(status.getAttribute('data-relative-tick')).toBe('1')
    }
  })

  it('shows error state when save failed', () => {
    render(
      <EditorActionBar {...baseProps} error="Network error" hasUnsavedChanges />
    )
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent("Couldn't save")
      expect(status).toHaveAttribute(
        'title',
        `Network error · ${AUTO_SAVE_GUIDANCE}`
      )
    }
  })

  it('shows Unsaved changes when dirty and not saving', () => {
    render(<EditorActionBar {...baseProps} hasUnsavedChanges />)
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent('Unsaved changes')
    }
  })

  it('shows Not saved yet when no save and not dirty', () => {
    render(<EditorActionBar {...baseProps} />)
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent('Not saved yet')
    }
  })
})

describe('EditorActionBar publish requirements', () => {
  it('shows a visible banner when publishBlockReason is set', () => {
    const reason =
      'Please add an excerpt of at least 10 characters before publishing'
    render(
      <EditorActionBar
        {...baseProps}
        canPublish
        publishBlockReason={reason}
      />
    )
    expect(screen.getByText(reason)).toBeVisible()
  })

  it('associates Publish with the block reason via aria-describedby', () => {
    const reason = 'Please replace "Untitled" with a real title before publishing'
    render(
      <EditorActionBar
        {...baseProps}
        canPublish
        publishBlockReason={reason}
      />
    )
    const publishButtons = screen.getAllByRole('button', { name: 'Publish' })
    const describedBy = publishButtons[0]!.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const banner = document.getElementById(describedBy!)
    expect(banner).toHaveTextContent(reason)
  })

  it('does not show publish block banner when already published', () => {
    render(
      <EditorActionBar
        {...baseProps}
        isPublished
        publishBlockReason="Please add an excerpt of at least 10 characters before publishing"
      />
    )
    expect(screen.queryByText(/excerpt of at least/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Published').length).toBeGreaterThanOrEqual(1)
  })
})
