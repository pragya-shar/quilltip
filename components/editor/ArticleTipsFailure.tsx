'use client'

import type { ArticleActionMessage } from '@/lib/stellar/v2/article-actions'

/** A failed attempt: what happened, what to do, and a way to retry. */
export function ArticleTipsFailure({
  message,
  retryLabel,
  onRetry,
  onDismiss,
}: {
  message: ArticleActionMessage
  retryLabel: string
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div className="tips-failure" role="alert">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.01" />
      </svg>
      <div>
        <p className="tips-failure-title">{message.title}</p>
        <p>{message.detail}</p>
        <div className="tips-actions">
          <button type="button" className="tips-secondary" onClick={onRetry}>
            {retryLabel}
          </button>
          <button
            type="button"
            className="tips-text-button"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
