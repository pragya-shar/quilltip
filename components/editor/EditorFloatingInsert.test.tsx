/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Editor } from '@tiptap/react'
import { EditorFloatingInsert } from '@/components/editor/EditorFloatingInsert'

function makeEmptyParagraphEditor(): Editor {
  const parent = { type: { name: 'paragraph' }, content: { size: 0 } }
  const chain = {
    focus: () => ({
      toggleHeading: () => ({ run: () => true }),
      toggleBlockquote: () => ({ run: () => true }),
      toggleCodeBlock: () => ({ run: () => true }),
      toggleBulletList: () => ({ run: () => true }),
      toggleOrderedList: () => ({ run: () => true }),
    }),
  }

  return {
    state: {
      selection: {
        $from: {
          parent,
          pos: 1,
        },
      },
    },
    isActive: () => false,
    chain: () => chain,
    view: {
      coordsAtPos: () => ({ top: 240, left: 120 }),
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor
}

describe('EditorFloatingInsert', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows format and media controls when the insert menu is opened', async () => {
    const user = userEvent.setup()
    const onInsertImage = vi.fn()
    const onInsertYouTube = vi.fn()
    const editor = makeEmptyParagraphEditor()

    render(
      <EditorFloatingInsert
        editor={editor}
        onInsertImage={onInsertImage}
        onInsertYouTube={onInsertYouTube}
      />
    )

    const handler = vi.mocked(editor.on).mock.calls.find(
      ([event]) => event === 'selectionUpdate'
    )?.[1]
    act(() => {
      handler?.()
    })

    await user.click(await screen.findByRole('button', { name: 'Insert block' }))

    expect(screen.getByRole('group', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Media' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Numbered list' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Embed YouTube' })).toBeInTheDocument()
  })

  it('calls media callbacks from the insert menu', async () => {
    const user = userEvent.setup()
    const onInsertImage = vi.fn()
    const onInsertYouTube = vi.fn()
    const editor = makeEmptyParagraphEditor()

    render(
      <EditorFloatingInsert
        editor={editor}
        onInsertImage={onInsertImage}
        onInsertYouTube={onInsertYouTube}
      />
    )

    const handler = vi.mocked(editor.on).mock.calls.find(
      ([event]) => event === 'selectionUpdate'
    )?.[1]
    act(() => {
      handler?.()
    })

    await user.click(await screen.findByRole('button', { name: 'Insert block' }))
    await user.click(screen.getByRole('button', { name: 'Insert image' }))
    await user.click(screen.getByRole('button', { name: 'Insert block' }))
    await user.click(screen.getByRole('button', { name: 'Embed YouTube' }))

    expect(onInsertImage).toHaveBeenCalledTimes(1)
    expect(onInsertYouTube).toHaveBeenCalledTimes(1)
  })
})
