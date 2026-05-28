import type { FlowFeedback } from '@/lib/feedback/flow-feedback'

export const PUBLISH_EMPTY_CONTENT_FEEDBACK: FlowFeedback = {
  variant: 'default',
  title: 'Add content before publishing',
  detail: 'Write something in the editor, then try again.',
}

export function publishErrorFeedback(error: unknown): FlowFeedback {
  const message =
    error instanceof Error ? error.message : 'Unknown error'
  return {
    variant: 'destructive',
    title: 'Failed to publish',
    detail: message,
  }
}
