/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import {
  buildHighlightAriaLabel,
  buildHighlightMarkStyle,
  createHighlightControlButton,
  cssStringValue,
  parseHighlightUserNameFromElement,
} from './HighlightExtension'

describe('HighlightExtension helpers', () => {
  it('cssStringValue escapes quotes and backslashes', () => {
    expect(cssStringValue('Jane "Doc" Doe')).toBe('"Jane \\"Doc\\" Doe"')
    expect(cssStringValue('path\\to')).toBe('"path\\\\to"')
  })

  it('buildHighlightMarkStyle includes user name CSS var without data attribute', () => {
    const style = buildHighlightMarkStyle({
      color: '#F59E0B',
      userName: 'Jane Doe',
    })
    expect(style).toContain('--highlight-color: #F59E0B')
    expect(style).toContain('--highlight-color-rgb: 204, 148, 52')
    expect(style).toContain('--highlight-mix: 18%')
    expect(style).not.toContain('--highlight-opacity')
    expect(style).toContain('--highlight-user-name: "Jane Doe"')
    expect(style).not.toContain('data-user-name')
  })

  it('parseHighlightUserNameFromElement reads CSS var and legacy attribute', () => {
    const fromStyle = document.createElement('mark')
    fromStyle.setAttribute(
      'style',
      '--highlight-user-name: "Alice Smith"; --highlight-color: #F59E0B;'
    )
    expect(parseHighlightUserNameFromElement(fromStyle)).toBe('Alice Smith')

    const legacy = document.createElement('mark')
    legacy.setAttribute('data-user-name', 'Bob')
    expect(parseHighlightUserNameFromElement(legacy)).toBe('Bob')
  })

  it('buildHighlightAriaLabel includes creator and note', () => {
    expect(buildHighlightAriaLabel({ userName: 'Jane' })).toBe(
      'Highlight by Jane'
    )
    expect(
      buildHighlightAriaLabel({
        userName: 'Jane',
        note: 'Great point',
      })
    ).toBe('Highlight by Jane. Note: Great point')
    expect(buildHighlightAriaLabel({})).toBe('Highlight by Anonymous')
  })

  it('createHighlightControlButton exposes metadata only on the control', () => {
    const onHighlightClick = vi.fn()
    const button = createHighlightControlButton(
      {
        id: 'hl-1',
        color: '#F59E0B',
        userId: 'user-1',
        userName: 'Jane Doe',
        createdAt: 0,
      },
      onHighlightClick
    )

    expect(button.getAttribute('aria-label')).toBe('Highlight by Jane Doe')
    expect(button.className).toBe('highlight-attribution-control')

    button.click()
    expect(onHighlightClick).toHaveBeenCalledTimes(1)

    button.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    expect(onHighlightClick).toHaveBeenCalledTimes(2)
  })
})

describe('HighlightExtension mark HTML', () => {
  it('does not render data-user-name or title on marks', () => {
    expect(buildHighlightMarkStyle({ userName: 'Jane Doe' })).toContain(
      '--highlight-user-name: "Jane Doe"'
    )
    expect(buildHighlightMarkStyle({ userName: 'Jane Doe' })).not.toContain(
      'data-user-name'
    )

    const noteOnly = { 'data-note': 'A note' } as const
    expect(noteOnly).not.toHaveProperty('title')
  })
})
