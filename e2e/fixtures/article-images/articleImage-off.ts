// Fixture only (#615): the renderer check switched off, so the page policy
// can be shown to block an outside image on its own. `?renderer=off` serves
// the server HTML and the readers built with this in place of
// lib/tiptap/articleImage.ts.
export { HIDDEN_ARTICLE_IMAGE } from '../../../lib/tiptap/articleImage'

export function isArticleImageShown(): boolean {
  return true
}
