// @vitest-environment happy-dom
/**
 * A press on the passage tip bar keeps the chosen passage. The bar renders
 * inside the article element, whose press handler closes the passage
 * (`HighlightableArticle` -> `handleArticleHighlightOverlayPointerDown`).
 * The bar opts out with `data-article-overlay`; a press on the article text
 * still closes. The real-browser check is the guarded journey
 * (`e2e/real-run/journey.ts`).
 */
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassageTipBar } from '../../components/payments/PassageTipBar'
import { handleArticleHighlightOverlayPointerDown } from '../../lib/highlights/articleOverlayPointerDismiss'
import { money } from '../../lib/payments/money'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// The stylesheet plays no part in press handling.
vi.mock('../../components/payments/balance.css', () => ({}))

afterEach(() => {
  document.body.innerHTML = ''
})

async function articleWithBar(trayOpen: boolean) {
  const article = document.createElement('div')
  const text = document.createElement('p')
  text.textContent = 'Leave it overnight.'
  const slot = document.createElement('div')
  article.append(text, slot)
  document.body.append(article)
  const close = vi.fn()
  const onPress = (event: Event) =>
    handleArticleHighlightOverlayPointerDown(event.target, {
      closeCreatePopover: close,
      closeDetailsPanel: () => {},
    })
  article.addEventListener('mousedown', onPress)
  article.addEventListener('touchstart', onPress)
  await act(async () => {
    createRoot(slot).render(
      h(PassageTipBar, {
        phase: { phase: 'idle' },
        label: 'Tip this line $0.10',
        amount: money(10),
        amounts: [money(10), money(25), money(50)],
        trayOpen,
        status: { text: '≈ $2.54 ready to tip.' },
        live: true,
        onTip: () => {},
        onToggleTray: () => {},
        onChooseAmount: () => {},
        onClear: () => {},
        onHighlight: () => {},
      })
    )
  })
  return { article, text, close }
}

const press = (target: Element, type: 'mousedown' | 'touchstart') =>
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))

describe('passage tip bar press', () => {
  it('keeps the passage for a press on any control in the bar', async () => {
    for (const trayOpen of [false, true]) {
      const { article, close } = await articleWithBar(trayOpen)
      const controls = article.querySelectorAll(
        '[data-testid="passage-tip-bar"] button, [data-testid="passage-tip-bar"] input, [data-testid="passage-tip-bar"] label'
      )
      expect(controls.length).toBeGreaterThan(trayOpen ? 6 : 3)
      for (const control of controls) {
        press(control, 'mousedown')
        press(control, 'touchstart')
      }
      expect(close).not.toHaveBeenCalled()
      document.body.innerHTML = ''
    }
  })

  it('closes the passage for a press on the article text', async () => {
    const { text, close } = await articleWithBar(false)
    press(text, 'touchstart')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
