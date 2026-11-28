import { convexErrorMessage } from '@/lib/feedback/convexErrorMessage'
import type { FlowFeedback } from '@/lib/feedback/flow-feedback'

export const PUBLISH_EMPTY_CONTENT_FEEDBACK: FlowFeedback = {
  variant: 'default',
  title: 'Add content before publishing',
  detail: 'Write something in the editor, then try again.',
}

/** Shown for a publish that failed without a reason for the writer. */
export const PUBLISH_FAILED_DETAIL =
  'Something went wrong. Check your connection and try again.'

/**
 * A failed publish, for the writer: the refusal's own words when Convex
 * refused with a `ConvexError` (an image from another host, for example),
 * else a plain line. Never the raw client error, which carries the function
 * name, a request id and, in development, a stack.
 */
export function publishErrorFeedback(error: unknown): FlowFeedback {
  return {
    variant: 'destructive',
    title: 'Could not publish',
    detail: convexErrorMessage(error) ?? PUBLISH_FAILED_DETAIL,
  }
}

/** A publish the page stopped before calling Convex, with its reason. */
export function publishBlockedFeedback(detail: string): FlowFeedback {
  return { variant: 'destructive', title: 'Could not publish', detail }
}

/** Where a publish message shows: one place at a time, so it is read once. */
export type PublishFeedbackPlace = 'confirm' | 'drawer' | 'notice'

/**
 * The confirmation dialog when it is open, else the publish drawer when it
 * is open, else the workspace notice.
 */
export function publishFeedbackPlace(state: {
  confirmOpen: boolean
  drawerOpen: boolean
}): PublishFeedbackPlace {
  if (state.confirmOpen) return 'confirm'
  if (state.drawerOpen) return 'drawer'
  return 'notice'
}
