// convex/react for the read suite: no backend. The live article answers as
// `?doc=` says (current by default, changed, tipped or gone); mutations are
// recorded by the fixture server, so the spec can see what was saved.
import { getFunctionName, type FunctionReference } from 'convex/server'
import { ARTICLE } from './article'

const params = new URLSearchParams(location.search)
const run = params.get('run') ?? 'default'
const live = params.get('doc') ?? 'current'

const kept = params.get('kept') === '1'

/** The reader's kept line in the fixture: the quote's last sentence. */
export const KEPT_LINE = {
  _id: 'hk1',
  userId: 'u1',
  text: 'It rarely remembers anyone.',
}

// Answers are stable objects, as the live client's are between updates.
const LIVE_ARTICLE =
  live === 'gone'
    ? null
    : live === 'changed'
      ? { ...ARTICLE, contentVersion: 2 }
      : // A tip by another reader moves updatedAt, not the text.
        live === 'tipped'
        ? { ...ARTICLE, updatedAt: ARTICLE.updatedAt + 1 }
        : ARTICLE
const ME = { _id: 'u1' }
const NO_ROWS: unknown[] = []
let keptRows: unknown[] | undefined

export function useQuery(ref: FunctionReference<'query'>, args?: unknown) {
  if (args === 'skip') return undefined
  switch (getFunctionName(ref)) {
    case 'articles:getArticleBySlug':
      return LIVE_ARTICLE
    case 'users:getCurrentUser':
      return ME
    case 'highlights:getArticleHighlights':
      if (!kept) return NO_ROWS
      // Found in the rendered text once it is on the page.
      if (!keptRows && document.getElementById('read-body'))
        keptRows = [keptRow()]
      return keptRows
    default:
      return undefined
  }
}

/** The kept line's offsets, found in the rendered body's text. */
function keptRow() {
  const body = document.getElementById('read-body')
  const walker = body && document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let seen = 0
  for (let node = walker?.nextNode(); node; node = walker!.nextNode()) {
    if (node.parentElement?.closest('figcaption, [data-read-skip]')) continue
    const at = node.textContent!.indexOf(KEPT_LINE.text)
    if (at >= 0)
      return {
        ...KEPT_LINE,
        startOffset: seen + at,
        endOffset: seen + at + KEPT_LINE.text.length,
      }
    seen += node.textContent!.length
  }
  return { ...KEPT_LINE, startOffset: 0, endOffset: 0, removedAt: 1 }
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
