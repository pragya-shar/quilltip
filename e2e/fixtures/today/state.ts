import { answerFixtureQuery } from '../../../scripts/perf/convex-fixture'
import type { TodayData, TodayResult } from '../../../components/today/types'
import type { DraftSummary } from '../../../components/today/rowsSource'

/**
 * What one fixture page shows, from its query string:
 * - `data`: ready (default), empty, unreachable, long (worst-case text).
 * - `auth`: signed-out (default), signed-in, loading (never answers).
 * - `draft`: none (default) or some: the signed-in person's latest draft.
 * - `delay`: ms before auth and drafts answer, like a slow backend (300).
 */
export type FixtureState = {
  data: 'ready' | 'empty' | 'unreachable' | 'long'
  auth: 'signed-out' | 'signed-in' | 'loading'
  draft: DraftSummary | null
  delay: number
}

export const FIXTURE_NOW = Date.UTC(2026, 10, 28, 7)

export function stateFrom(search: string): FixtureState {
  const params = new URLSearchParams(search)
  const data = params.get('data')
  const auth = params.get('auth')
  return {
    data:
      data === 'empty' || data === 'unreachable' || data === 'long'
        ? data
        : 'ready',
    auth: auth === 'signed-in' || auth === 'loading' ? auth : 'signed-out',
    draft:
      params.get('draft') === 'some'
        ? {
            id: 'draftfixture0001',
            title: 'The year I stopped buying books',
            words: 812,
          }
        : null,
    delay: Number(params.get('delay') ?? 300) || 0,
  }
}

const LONG_WORD = 'Unbreakablewordwithoutanyspacesthatkeepsgoingandgoing'

function longResult(base: TodayResult): TodayResult {
  const opening = base.opening!
  return {
    ...base,
    opening: {
      ...opening,
      title: `${LONG_WORD} and a title long enough to wrap over four or five lines on a phone`,
      author: {
        name: `Writer ${LONG_WORD}`,
        username: 'writer_with_a_long_handle',
      },
      paragraphs: [
        `${LONG_WORD} ${opening.paragraphs[0]}`,
        ...opening.paragraphs.slice(1),
      ],
    },
    more: base.more.map((item) => ({
      ...item,
      title: `${LONG_WORD} ${item.title}`,
      first: `${LONG_WORD} ${item.first}`,
      author: { ...item.author, name: `Ama ${LONG_WORD}` },
    })),
  }
}

export function todayData(state: FixtureState): TodayData {
  if (state.data === 'unreachable') return { status: 'unreachable' }
  const result = answerFixtureQuery('today:opening', { at: FIXTURE_NOW })!
    .value as TodayResult
  if (state.data === 'empty')
    return { status: 'ready', result: { ...result, opening: null, more: [] } }
  if (state.data === 'long')
    return { status: 'ready', result: longResult(result) }
  return { status: 'ready', result }
}
