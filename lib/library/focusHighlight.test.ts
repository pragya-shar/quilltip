/** @vitest-environment jsdom */
import { it, expect, vi } from 'vitest'
import { focusLibraryHighlight } from './focusHighlight'
it('returns the reader to the exact saved highlight, without interpreting the id as a selector', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<mark data-highlight-id="one">First</mark><mark data-highlight-id="two">Second</mark>'
  document.body.append(root)
  const second = root.children[1] as HTMLElement
  const scroll = vi.fn()
  second.scrollIntoView = scroll
  expect(focusLibraryHighlight(root, 'two', true)).toBe(true)
  expect(second).toHaveFocus()
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' })
  expect(focusLibraryHighlight(root, 'x"]')).toBe(false)
  root.remove()
})
