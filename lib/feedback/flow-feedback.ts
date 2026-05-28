export type FlowFeedbackVariant = 'destructive' | 'default'

export type FlowFeedback = {
  variant: FlowFeedbackVariant
  title: string
  detail?: string
}

export function truncateFeedbackMessage(message: string, maxLength = 120): string {
  if (message.length <= maxLength) return message
  return `${message.slice(0, maxLength - 1)}…`
}
