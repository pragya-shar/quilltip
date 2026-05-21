import { describe, expect, it } from 'vitest'
import { clampFixedPanelPosition } from './clampFixedPanelPosition'

const viewport = { width: 400, height: 800 }
const panel = { width: 200, height: 300 }
const margin = 12

describe('clampFixedPanelPosition', () => {
  it('centers horizontally on anchor when there is room', () => {
    const result = clampFixedPanelPosition(
      { top: 100, left: 200 },
      panel,
      viewport,
      margin
    )
    expect(result.left).toBe(100)
    expect(result.top).toBe(100)
  })

  it('clamps left edge when anchor is near the left', () => {
    const result = clampFixedPanelPosition(
      { top: 100, left: 20 },
      panel,
      viewport,
      margin
    )
    expect(result.left).toBe(margin)
  })

  it('clamps right edge when anchor is near the right', () => {
    const result = clampFixedPanelPosition(
      { top: 100, left: 390 },
      panel,
      viewport,
      margin
    )
    expect(result.left).toBe(viewport.width - margin - panel.width)
  })

  it('clamps top when anchor is above the viewport margin', () => {
    const result = clampFixedPanelPosition(
      { top: 0, left: 200 },
      panel,
      viewport,
      margin
    )
    expect(result.top).toBe(margin)
  })

  it('clamps bottom when anchor is below the viewport margin', () => {
    const result = clampFixedPanelPosition(
      { top: 700, left: 200 },
      panel,
      viewport,
      margin
    )
    expect(result.top).toBe(viewport.height - margin - panel.height)
  })

  it('keeps panel as far in-bounds as possible on narrow viewports', () => {
    const narrow = { width: 320, height: 600 }
    const smallPanel = { width: 280, height: 260 }
    const result = clampFixedPanelPosition(
      { top: 50, left: 300 },
      smallPanel,
      narrow,
      margin
    )
    expect(result.left).toBe(narrow.width - margin - smallPanel.width)
    expect(result.top).toBe(50)
  })
})
