/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import {
  ArticleAppearance,
  getArticleAppearance,
  setArticleAppearance,
} from './articleAppearance'
describe('draft appearance', () => {
  it('persists palette and typography in document JSON without changing words', () => {
    const editor = new Editor({
      extensions: [StarterKit, ArticleAppearance],
      content: '<p>Keep these words.</p>',
    })
    setArticleAppearance(editor, {
      paper: 'sage',
      type: 'modern',
      coverAlt: 'A garden',
    })
    const json = editor.getJSON()
    const reopened = new Editor({
      extensions: [StarterKit, ArticleAppearance],
      content: json,
    })
    expect(getArticleAppearance(reopened.getJSON())).toEqual({
      paper: 'sage',
      type: 'modern',
      coverAlt: 'A garden',
    })
    expect(reopened.getText()).toBe('Keep these words.')
    editor.destroy()
    reopened.destroy()
  })
  it('uses safe defaults for legacy and malformed metadata', () => {
    expect(getArticleAppearance({ type: 'doc' })).toEqual({
      paper: 'cream',
      type: 'literary',
      coverAlt: '',
    })
    expect(
      getArticleAppearance({
        type: 'doc',
        attrs: {
          quilltipAppearance: { paper: 'url(evil)', type: 'arbitrary' },
        },
      })
    ).toEqual({ paper: 'cream', type: 'literary', coverAlt: '' })
  })
})
