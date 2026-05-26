import { describe, expect, it } from 'vitest'
import {
  assertPublishableArticleTitle,
  isPlaceholderArticleTitle,
} from './articleTitle'

describe('isPlaceholderArticleTitle', () => {
  it('treats empty and whitespace-only titles as placeholder', () => {
    expect(isPlaceholderArticleTitle('')).toBe(true)
    expect(isPlaceholderArticleTitle('   ')).toBe(true)
  })

  it('treats Untitled case-insensitively as placeholder', () => {
    expect(isPlaceholderArticleTitle('Untitled')).toBe(true)
    expect(isPlaceholderArticleTitle('untitled')).toBe(true)
    expect(isPlaceholderArticleTitle('UNTITLED')).toBe(true)
    expect(isPlaceholderArticleTitle('  Untitled  ')).toBe(true)
  })

  it('allows real titles that mention untitled', () => {
    expect(isPlaceholderArticleTitle('Untitled Story')).toBe(false)
    expect(isPlaceholderArticleTitle('My first post')).toBe(false)
  })
})

describe('assertPublishableArticleTitle', () => {
  it('throws for placeholder titles', () => {
    expect(() => assertPublishableArticleTitle('Untitled')).toThrow(
      'Cannot publish: add a title before publishing'
    )
  })

  it('does not throw for meaningful titles', () => {
    expect(() => assertPublishableArticleTitle('A real title')).not.toThrow()
  })
})
