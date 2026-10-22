import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import type { CSSProperties } from 'react'

export const PAPER_COLORS = {
  cream: '#eee3cf',
  rose: '#efdcdb',
  linen: '#f7f3e9',
  sage: '#e3e7da',
} as const
export type ArticleStyle = {
  paper: keyof typeof PAPER_COLORS
  type: 'literary' | 'modern'
  coverAlt: string
}
export const ArticleAppearance = Extension.create({
  name: 'articleAppearance',
  addGlobalAttributes() {
    return [
      {
        types: ['doc'],
        attributes: { quilltipAppearance: { default: null, rendered: false } },
      },
    ]
  },
})
export function getArticleAppearance(
  content: JSONContent | null | undefined
): ArticleStyle {
  const value = content?.attrs?.quilltipAppearance
  return {
    paper:
      value && Object.hasOwn(PAPER_COLORS, value.paper) ? value.paper : 'cream',
    type: value?.type === 'modern' ? 'modern' : 'literary',
    coverAlt:
      typeof value?.coverAlt === 'string' ? value.coverAlt.slice(0, 300) : '',
  }
}
export function setArticleAppearance(editor: Editor, value: ArticleStyle) {
  editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) tr.setDocAttribute('quilltipAppearance', value)
    return true
  })
}
export function articleStyleVariables(style: ArticleStyle): CSSProperties {
  return {
    '--paper': PAPER_COLORS[style.paper],
    '--article-font':
      style.type === 'modern'
        ? 'Writing Work, sans-serif'
        : 'Writing Literata, Georgia, serif',
    '--title-font':
      style.type === 'modern'
        ? 'Writing Syne, sans-serif'
        : 'Writing Literata, Georgia, serif',
  } as CSSProperties
}
