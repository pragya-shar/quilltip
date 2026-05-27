/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Editor } from '@tiptap/react'
import { EditorToolbar } from '@/components/editor/EditorToolbar'

const useIsMobileMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => useIsMobileMock(),
}))

function makeStubEditor(): Editor {
  return {
    isActive: () => false,
    chain: () => ({
      focus: () => ({
        toggleBold: () => ({ run: () => true }),
        toggleItalic: () => ({ run: () => true }),
        toggleUnderline: () => ({ run: () => true }),
        toggleStrike: () => ({ run: () => true }),
        toggleBlockquote: () => ({ run: () => true }),
        toggleCodeBlock: () => ({ run: () => true }),
        toggleOrderedList: () => ({ run: () => true }),
        toggleBulletList: () => ({ run: () => true }),
        setParagraph: () => ({ run: () => true }),
        toggleHeading: () => ({ run: () => true }),
      }),
    }),
  } as unknown as Editor
}

describe('EditorToolbar notes', () => {
  beforeEach(() => {
    useIsMobileMock.mockReturnValue(false)
  })

  it('opens desktop notes popover when Notes is clicked', async () => {
    const user = userEvent.setup()
    render(
      <EditorToolbar
        editor={makeStubEditor()}
        notes=""
        onNotesChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Notes' }))

    expect(screen.getByRole('dialog', { name: 'Personal notes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })

  it('opens mobile notes drawer with Done control', async () => {
    useIsMobileMock.mockReturnValue(true)
    const user = userEvent.setup()
    render(
      <EditorToolbar
        editor={makeStubEditor()}
        notes=""
        onNotesChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Notes' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Personal notes', { selector: 'div[role="dialog"]' })
    ).not.toBeInTheDocument()
  })

  it('calls onNotesChange when editing notes in mobile drawer', async () => {
    useIsMobileMock.mockReturnValue(true)
    const onNotesChange = vi.fn()
    const user = userEvent.setup()
    render(
      <EditorToolbar
        editor={makeStubEditor()}
        notes=""
        onNotesChange={onNotesChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Notes' }))
    fireEvent.change(screen.getByLabelText('Personal notes'), {
      target: { value: 'Plan chapter 2' },
    })

    expect(onNotesChange).toHaveBeenCalledWith('Plan chapter 2')
  })
})
