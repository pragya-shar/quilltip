import { Extension, type Editor, type JSONContent } from '@tiptap/core'

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
export const PAPER_SWATCH_CLASSES = {
  cream: '[--swatch:#eee3cf]',
  rose: '[--swatch:#efdcdb]',
  linen: '[--swatch:#f7f3e9]',
  sage: '[--swatch:#e3e7da]',
} as const
const PAPER_CLASSES = {
  cream: '[--paper:#eee3cf]!',
  rose: '[--paper:#efdcdb]!',
  linen: '[--paper:#f7f3e9]!',
  sage: '[--paper:#e3e7da]!',
} as const
export function articleAppearanceClasses(style: ArticleStyle): string {
  return `${PAPER_CLASSES[style.paper]} ${
    style.type === 'modern'
      ? '[--article-font:Writing_Work,sans-serif]! [--title-font:Writing_Syne,sans-serif]!'
      : '[--article-font:Writing_Literata,Georgia,serif]! [--title-font:Writing_Literata,Georgia,serif]!'
  }`
}
