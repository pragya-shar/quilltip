/** @vitest-environment jsdom */
import { beforeEach, describe, it, expect } from 'vitest'
import { readBookmarks, toggleBookmark } from './bookmarks'
const article = {
  id: 'article-one',
  title: 'A story',
  author: 'Maya',
  username: 'maya',
  slug: 'a-story',
  topic: 'Life',
  minutes: 3,
}
describe('account-local bookmarks', () => {
  beforeEach(() => localStorage.clear())
  it('persists a toggle for one account without leaking to another', () => {
    toggleBookmark('alice', article)
    expect(readBookmarks('alice')).toEqual([article])
    expect(readBookmarks('bob')).toEqual([])
    toggleBookmark('alice', article)
    expect(readBookmarks('alice')).toEqual([])
  })
  it('rejects unsafe or malformed stored records', () => {
    localStorage.setItem(
      'quilltip.bookmarks.v1:alice',
      JSON.stringify([{ ...article, username: '//evil.example' }, null, {}])
    )
    expect(readBookmarks('alice')).toEqual([])
  })
})
