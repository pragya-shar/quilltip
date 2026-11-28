// Published articles are permanent: the permanent storage copy is written once
// at publish, so the Quilltip page must not drift from it. Only drafts can be
// changed. Shared by the Convex mutations and the editor UI.

export const PUBLISHED_ARTICLE_LOCKED_MESSAGE =
  "Published articles can't be changed."

export function isArticleLocked(article: { published: boolean }): boolean {
  return article.published
}
