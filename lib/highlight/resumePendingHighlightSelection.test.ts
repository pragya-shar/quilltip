/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import {
  applyPendingHighlightToEditor,
  readEditorSelectionAnchor,
  readPendingHighlightPopoverAnchor,
  shouldKeepTryingHighlightSelectionResume,
} from './resumePendingHighlightSelection'

describe('resumePendingHighlightSelection', () => {
  it('shouldKeepTrying when pending matches and editor not yet restored', () => {
    expect(
      shouldKeepTryingHighlightSelectionResume(
        {
          articleId: 'articles:1',
          highlightText: 'hello world',
          startOffset: 0,
          endOffset: 11,
        },
        'articles:1',
        null,
        {} as never
      )
    ).toBe(true)
  })

  it('stops retrying after selection restored on current editor', () => {
    const editor = {} as never
    expect(
      shouldKeepTryingHighlightSelectionResume(
        {
          articleId: 'articles:1',
          highlightText: 'hello world',
          startOffset: 0,
          endOffset: 11,
        },
        'articles:1',
        editor,
        editor
      )
    ).toBe(false)
  })

  it('applyPendingHighlightToEditor focuses and sets text selection', () => {
    const run = vi.fn()
    const chain = {
      focus: vi.fn().mockReturnThis(),
      setTextSelection: vi.fn().mockReturnThis(),
      scrollIntoView: vi.fn().mockReturnThis(),
      run,
    }
    const editor = {
      chain: vi.fn(() => chain),
    }

    applyPendingHighlightToEditor(editor as never, {
      articleId: 'articles:1',
      highlightText: 'hello',
      startOffset: 2,
      endOffset: 7,
    })

    expect(chain.focus).toHaveBeenCalled()
    expect(chain.setTextSelection).toHaveBeenCalledWith({ from: 2, to: 7 })
    expect(chain.scrollIntoView).toHaveBeenCalled()
    expect(run).toHaveBeenCalled()
  })

  it('readEditorSelectionAnchor uses coordsAtPos', () => {
    const editor = {
      state: { selection: { from: 2, to: 7, empty: false } },
      view: {
        coordsAtPos: (pos: number) =>
          pos === 2
            ? { top: 100, left: 50, bottom: 120, right: 80 }
            : { top: 100, left: 150, bottom: 120, right: 180 },
      },
    }

    expect(readEditorSelectionAnchor(editor as never)).toEqual({
      top: 100,
      left: 100,
    })
  })

  it('readPendingHighlightPopoverAnchor prefers editor coords', () => {
    const editor = {
      state: { selection: { from: 1, to: 5, empty: false } },
      view: {
        coordsAtPos: () => ({
          top: 200,
          left: 80,
          bottom: 220,
          right: 120,
        }),
      },
    }

    expect(readPendingHighlightPopoverAnchor(editor as never)).toEqual({
      top: 200,
      left: 80,
    })
  })
})
