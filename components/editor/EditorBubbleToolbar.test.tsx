/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Editor } from '@tiptap/react'
import { EditorBubbleToolbar } from '@/components/editor/EditorBubbleToolbar'

function makeStubEditor({
  overrides = {},
  commands = {},
}: {
  overrides?: Partial<Editor>
  commands?: Record<string, unknown>
} = {}): Editor {
  const chain = {
    focus: () => ({
      toggleBold: () => ({ run: () => true }),
      toggleItalic: () => ({ run: () => true }),
      toggleHeading: () => ({ run: () => true }),
      toggleUnderline: () => ({ run: () => true }),
      toggleStrike: () => ({ run: () => true }),
      toggleCode: () => ({ run: () => true }),
      toggleBlockquote: () => ({ run: () => true }),
      setTextAlign: () => ({ run: () => true }),
      extendMarkRange: () => ({
        setLink: () => ({ run: () => true }),
        unsetLink: () => ({ run: () => true }),
      }),
      unsetLink: () => ({ run: () => true }),
      ...commands,
    }),
  }

  return {
    state: { selection: { empty: false } },
    isActive: () => false,
    chain: () => chain,
    can: () => ({
      chain: () => ({
        focus: () => ({
          setTextAlign: () => ({ run: () => true }),
        }),
      }),
    }),
    on: vi.fn(),
    off: vi.fn(),
    commands: { focus: vi.fn() },
    ...overrides,
  } as unknown as Editor
}

function mockSelectionRect() {
  const range = {
    getBoundingClientRect: () => ({
      top: 200,
      left: 100,
      width: 80,
      height: 20,
    }),
  }
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    getRangeAt: () => range as unknown as Range,
  } as unknown as Selection)
}

describe('EditorBubbleToolbar', () => {
  beforeEach(() => {
    mockSelectionRect()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders core formatting buttons when text is selected', async () => {
    const editor = makeStubEditor()
    render(<EditorBubbleToolbar editor={editor} />)

    const handler = vi
      .mocked(editor.on)
      .mock.calls.find(([event]) => event === 'selectionUpdate')?.[1]
    act(() => {
      handler?.()
    })

    expect(
      await screen.findByRole('button', { name: 'Bold' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add link' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More formatting' })
    ).toBeInTheDocument()
  })

  it('shows overflow formatting options from the more menu', async () => {
    const user = userEvent.setup()
    const editor = makeStubEditor()
    render(<EditorBubbleToolbar editor={editor} />)

    const handler = vi
      .mocked(editor.on)
      .mock.calls.find(([event]) => event === 'selectionUpdate')?.[1]
    act(() => {
      handler?.()
    })

    await user.click(
      await screen.findByRole('button', { name: 'More formatting' })
    )

    expect(screen.getByText('Underline')).toBeInTheDocument()
    expect(screen.getByText('Strikethrough')).toBeInTheDocument()
    expect(screen.getByText('Inline code')).toBeInTheDocument()
    expect(screen.getByText('Blockquote')).toBeInTheDocument()
    expect(screen.getByText('Alignment')).toBeInTheDocument()
  })

  it('keeps H2 and H3 available for selected text from the overflow menu', async () => {
    const user = userEvent.setup()
    const toggleHeading = vi.fn(() => ({ run: () => true }))
    const editor = makeStubEditor({ commands: { toggleHeading } })
    render(<EditorBubbleToolbar editor={editor} />)

    const handler = vi
      .mocked(editor.on)
      .mock.calls.find(([event]) => event === 'selectionUpdate')?.[1]
    act(() => {
      handler?.()
    })

    await user.click(
      await screen.findByRole('button', { name: 'More formatting' })
    )

    expect(screen.getByText('Heading 2')).toBeInTheDocument()
    expect(screen.getByText('Heading 3')).toBeInTheDocument()

    await user.click(screen.getByText('Heading 2'))
    await user.click(screen.getByRole('button', { name: 'More formatting' }))
    await user.click(screen.getByText('Heading 3'))

    expect(toggleHeading).toHaveBeenCalledWith({ level: 2 })
    expect(toggleHeading).toHaveBeenCalledWith({ level: 3 })
  })
})
