/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { handleArticleHighlightOverlayPointerDown } from '@/lib/highlights/articleOverlayPointerDismiss'

describe('handleArticleHighlightOverlayPointerDown', () => {
  it('dismisses overlays when pressing on article text', () => {
    document.body.innerHTML = `
      <p id="article-text">plain article text</p>
      <div role="dialog" id="panel"><button id="close">Close</button></div>
    `
    const closeCreatePopover = vi.fn()
    const closeDetailsPanel = vi.fn()

    handleArticleHighlightOverlayPointerDown(
      document.getElementById('article-text'),
      { closeCreatePopover, closeDetailsPanel }
    )

    expect(closeCreatePopover).toHaveBeenCalledTimes(1)
    expect(closeDetailsPanel).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss when pressing inside an open dialog', () => {
    document.body.innerHTML = `
      <p id="article-text">plain article text</p>
      <div role="dialog" id="panel"><button id="close">Close</button></div>
    `
    const closeCreatePopover = vi.fn()
    const closeDetailsPanel = vi.fn()

    handleArticleHighlightOverlayPointerDown(
      document.getElementById('close'),
      { closeCreatePopover, closeDetailsPanel }
    )

    expect(closeCreatePopover).not.toHaveBeenCalled()
    expect(closeDetailsPanel).not.toHaveBeenCalled()
  })
})
