// convex/react for the read suite: no backend. The live article answers as
// `?live=` says (current by default, changed or gone); mutations are
// recorded by the fixture server, so the spec can see what was saved.
import { getFunctionName, type FunctionReference } from 'convex/server'
import { ARTICLE } from './article'

const params = new URLSearchParams(location.search)
const run = params.get('run') ?? 'default'
const live = params.get('live') ?? 'current'

export function useQuery(ref: FunctionReference<'query'>, args?: unknown) {
  void args
  if (getFunctionName(ref) !== 'articles:getArticleBySlug') return undefined
  if (live === 'gone') return null
  if (live === 'changed') return { ...ARTICLE, contentVersion: 2 }
  return ARTICLE
}

export function useMutation(ref: FunctionReference<'mutation'>) {
  const name = getFunctionName(ref)
  return async (args: unknown) => {
    const response = await fetch(`/api/mutations?run=${run}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
    })
    if (!response.ok) throw new Error('Fixture mutation failed')
    return ((await response.json()) as { id: string }).id
  }
}

export const useConvexAuth = () => ({ isLoading: false, isAuthenticated: true })
