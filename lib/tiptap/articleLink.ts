import Link from '@tiptap/extension-link'

/** Every article link renders with these, whatever the document stores. */
export const ARTICLE_LINK_REL = 'noopener noreferrer'
export const ARTICLE_LINK_TARGET = '_blank'

/**
 * The link mark for article content, in the readers and in the editors. The
 * mark has one attribute, `href`: a `rel`, `target`, `class` or `title`
 * stored on a link in an older document is not part of the mark, so it is
 * neither rendered nor written back. `rel` and `target` are fixed above;
 * `className` is the screen's own styling. The link extension still empties
 * script and data addresses. The save path stores the same shape
 * (`convex/lib/articleContent.ts`).
 */
export function createArticleLinkExtension(options: {
  openOnClick: boolean
  className?: string
}) {
  return Link.extend({
    addAttributes() {
      return {
        href: {
          default: null,
          parseHTML: (element) => element.getAttribute('href'),
        },
      }
    },
  }).configure({
    openOnClick: options.openOnClick,
    HTMLAttributes: {
      rel: ARTICLE_LINK_REL,
      target: ARTICLE_LINK_TARGET,
      class: options.className ?? null,
    },
  })
}
