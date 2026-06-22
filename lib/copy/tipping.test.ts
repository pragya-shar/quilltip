import { describe, expect, it } from 'vitest'
import {
  tipDialogDescription,
  tipDialogTitle,
  tipHighlightDialogDescription,
  tipHighlightDialogTitle,
} from '@/lib/copy/tipping'

describe('tipping copy', () => {
  it('uses reader-first dialog framing', () => {
    expect(tipDialogTitle('Ada')).toBe('Support Ada')
    expect(tipDialogDescription()).toBe(
      'Show your appreciation with a tip for their work.'
    )
    expect(tipHighlightDialogTitle('Ada')).toBe('Support Ada')
    expect(tipHighlightDialogDescription('Ada')).toBe(
      'Tip Ada for this specific insight.'
    )
  })

  it('does not use micro-tip or inline fee copy', () => {
    expect(tipDialogDescription()).not.toMatch(/micro-tip/i)
    expect(tipDialogDescription()).not.toMatch(/97\.5%/)
    expect(tipHighlightDialogDescription('Ada')).not.toMatch(/97\.5%/)
  })
})
