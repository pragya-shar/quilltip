// Stands in for Convex, auth and the chain runtime on the passage selection
// fixture (#665). It is the tips-v2 fixture runtime with the article and a
// signed-out reader on top; nothing leaves the page.
import { useQuery as tipsQuery } from '../tips-v2/runtime'
import { ARTICLE } from './article'

export * from '../tips-v2/runtime'
export { default } from '../tips-v2/runtime'

export function useQuery(ref: unknown, args?: unknown) {
  const name = String(ref)
  const answer = tipsQuery(ref, args)
  if (args === 'skip') return undefined
  if (name === 'articles.getArticleById') return ARTICLE
  if (name === 'highlights.getArticleHighlights') return []
  return answer
}

/** Signed out by default; `?auth=in` signs in a reader. */
export function useAuth() {
  return new URLSearchParams(location.search).get('auth') === 'in'
    ? {
        user: { _id: 'qa-reader', username: 'reader', name: 'Reader' },
        isAuthenticated: true,
        isLoading: false,
      }
    : { user: null, isAuthenticated: false, isLoading: false }
}
