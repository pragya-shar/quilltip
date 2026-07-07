/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Editor } from '@tiptap/react'

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

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

function getActiveMoreOptionsButton(): HTMLButtonElement {
  const button = screen
    .getAllByRole('button', { name: 'More options' })
    .find((element): element is HTMLButtonElement => {
      return element instanceof HTMLButtonElement && !element.disabled
    })
  if (!button) throw new Error('Expected an active More options button')
  return button
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

  it('shows Saving... in status while isSaving with unsaved edits', () => {
    render(<EditorActionBar {...baseProps} isSaving hasUnsavedChanges />)
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent('Saving...')
    }
    expect(
      screen.queryByRole('button', { name: 'Saving...' })
    ).not.toBeInTheDocument()
  })

  it('shows save error in status and alert banner when error and dirty', () => {
    render(
      <EditorActionBar {...baseProps} error="Network error" hasUnsavedChanges />
    )
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent(/Couldn't save:?\s*Network error/)
    }
    expect(screen.getByRole('alert')).toHaveTextContent('Network error')
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
    const { container } = render(
      <EditorActionBar
        {...baseProps}
        lastSavedAt={t}
        hasUnsavedChanges={false}
      />
    )
    const tickEl = container.querySelector('[data-relative-tick]')
    expect(tickEl?.getAttribute('data-relative-tick')).toBe('0')
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(tickEl?.getAttribute('data-relative-tick')).toBe('1')
  })

  it('shows error state when save failed', () => {
    render(
      <EditorActionBar {...baseProps} error="Network error" hasUnsavedChanges />
    )
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent(/Couldn't save:?\s*Network error/)
      expect(status).toHaveAttribute(
        'title',
        `Network error · ${AUTO_SAVE_GUIDANCE}`
      )
    }
  })

  it('shows Unsaved when dirty and not saving', () => {
    render(<EditorActionBar {...baseProps} hasUnsavedChanges />)
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status).toHaveTextContent('Unsaved')
    }
  })

  it('hides draft status when no save activity yet', () => {
    render(<EditorActionBar {...baseProps} />)
    expect(screen.queryByText(/^Saved /)).not.toBeInTheDocument()
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument()
    expect(screen.queryByText('Saving...')).not.toBeInTheDocument()
    const statuses = screen.getAllByRole('status')
    for (const status of statuses) {
      expect(status.textContent).toBe('')
    }
  })
})

describe('EditorActionBar publish requirements', () => {
  it('shows publishBlockReason visibly while keeping an aria description', () => {
    const reason =
      'Please add an excerpt of at least 10 characters before publishing'
    render(
      <EditorActionBar {...baseProps} canPublish publishBlockReason={reason} />
    )
    const reasonEls = screen.getAllByText(reason)
    expect(
      reasonEls.some((element) => !element.classList.contains('sr-only'))
    ).toBe(true)
    expect(
      reasonEls.some((element) => element.classList.contains('sr-only'))
    ).toBe(true)
  })

  it('associates Publish with the block reason via aria-describedby', () => {
    const reason =
      'Please replace "Untitled" with a real title before publishing'
    render(
      <EditorActionBar {...baseProps} canPublish publishBlockReason={reason} />
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

  it('runs onBlockReasonClick when the visible block reason is clicked', async () => {
    const user = userEvent.setup()
    const reason =
      'Please add an excerpt of at least 10 characters before publishing'
    const onBlockReasonClick = vi.fn()

    render(
      <EditorActionBar
        {...baseProps}
        canPublish={false}
        publishBlockReason={reason}
        onBlockReasonClick={onBlockReasonClick}
      />
    )

    await user.click(screen.getByRole('button', { name: reason }))

    expect(onBlockReasonClick).toHaveBeenCalledTimes(1)
  })
})

describe('EditorActionBar excerpt menu', () => {
  it('expands excerpt textarea inside the more menu', async () => {
    const user = userEvent.setup()
    const onExcerptOpenChange = vi.fn()

    render(
      <EditorActionBar
        {...baseProps}
        excerpt=""
        onExcerptChange={vi.fn()}
        excerptOpen={false}
        onExcerptOpenChange={onExcerptOpenChange}
        moreMenuOpen
        onMoreMenuOpenChange={vi.fn()}
      />
    )

    await user.click(screen.getByText('Add excerpt'))

    expect(onExcerptOpenChange).toHaveBeenCalledWith(true)
  })

  it('shows Edit excerpt when excerpt text exists', () => {
    render(
      <EditorActionBar
        {...baseProps}
        excerpt="A short summary for the article."
        onExcerptChange={vi.fn()}
        excerptOpen={false}
        onExcerptOpenChange={vi.fn()}
        moreMenuOpen
        onMoreMenuOpenChange={vi.fn()}
      />
    )

    expect(screen.getByText('Edit excerpt')).toBeInTheDocument()
  })
})

describe('EditorActionBar notes menu', () => {
  it('shows personal notes inside the more menu instead of the top bar', async () => {
    const user = userEvent.setup()

    render(
      <EditorActionBar
        {...baseProps}
        notes=""
        onNotesChange={vi.fn()}
        moreMenuOpen
        onMoreMenuOpenChange={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Notes' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByText('Personal notes'))

    expect(screen.getByLabelText('Personal notes')).toBeInTheDocument()
  })
})

describe('EditorActionBar cover image menu', () => {
  it('shows Add cover image when onAddCoverImage is provided and no cover is set', async () => {
    const user = userEvent.setup()
    render(<EditorActionBar {...baseProps} onAddCoverImage={vi.fn()} />)

    await user.click(getActiveMoreOptionsButton())

    expect(screen.getByText('Add cover image')).toBeInTheDocument()
  })

  it('hides Add cover image when hasCoverImage is true', async () => {
    const user = userEvent.setup()
    render(
      <EditorActionBar {...baseProps} onAddCoverImage={vi.fn()} hasCoverImage />
    )

    await user.click(getActiveMoreOptionsButton())

    expect(screen.queryByText('Add cover image')).not.toBeInTheDocument()
  })

  it('calls onAddCoverImage when the menu item is selected', async () => {
    const user = userEvent.setup()
    const onAddCoverImage = vi.fn()
    render(<EditorActionBar {...baseProps} onAddCoverImage={onAddCoverImage} />)

    await user.click(getActiveMoreOptionsButton())
    await user.click(screen.getByText('Add cover image'))

    expect(onAddCoverImage).toHaveBeenCalledTimes(1)
  })
})
