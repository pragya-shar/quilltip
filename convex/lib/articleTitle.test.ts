import { describe, expect, it } from 'vitest'
import {
  assertPublishableArticleTitle,
  isPlaceholderArticleTitle,
  isPublishBlockedArticleTitle,
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

describe('isPublishBlockedArticleTitle', () => {
  it('blocks titles shorter than 3 characters after trim', () => {
    expect(isPublishBlockedArticleTitle('')).toBe(true)
    expect(isPublishBlockedArticleTitle('  ')).toBe(true)
    expect(isPublishBlockedArticleTitle('A')).toBe(true)
    expect(isPublishBlockedArticleTitle('  Ab  ')).toBe(true)
  })

  it('allows titles with at least 3 characters after trim', () => {
    expect(isPublishBlockedArticleTitle('Abc')).toBe(false)
    expect(isPublishBlockedArticleTitle('  Abc  ')).toBe(false)
  })
})

describe('assertPublishableArticleTitle', () => {
  it('throws for placeholder titles', () => {
    expect(() => assertPublishableArticleTitle('Untitled')).toThrow(
      'Cannot publish: add a title before publishing'
    )
  })

  it('throws for titles shorter than 3 characters', () => {
    expect(() => assertPublishableArticleTitle('Hi')).toThrow(
      'Cannot publish: add a title before publishing'
    )
  })

  it('does not throw for meaningful titles', () => {
    expect(() => assertPublishableArticleTitle('A real title')).not.toThrow()
  })
})
