import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'

/** What `today.opening` returns. */
export type TodayResult = FunctionReturnType<typeof api.today.opening>
export type TodayOpeningArticle = NonNullable<TodayResult['opening']>
export type TodayMoreItem = TodayResult['more'][number]

/**
 * What the page renders from: the query's answer, or `unreachable` when the
 * backend did not answer in time (the page then says so and still renders).
 */
export type TodayData =
  | { status: 'ready'; result: TodayResult }
  | { status: 'unreachable' }
