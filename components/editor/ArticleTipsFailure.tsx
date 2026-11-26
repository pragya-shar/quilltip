'use client'

import type { Ref } from 'react'
import type { ArticleActionMessage } from '@/lib/stellar/v2/article-actions'

/**
 * A failed attempt: what happened, what to do and, when another attempt can
 * help, a way to retry. It takes focus so the message is not missed.
 */
export function ArticleTipsFailure({
  message,
  retryLabel,
  onRetry,
  onDismiss,
  focusRef,
}: {
  message: ArticleActionMessage
  retryLabel: string | null
  onRetry: () => void
  onDismiss: () => void
  focusRef?: Ref<HTMLDivElement>
}) {
  return (
    <div className="tips-failure" role="alert" ref={focusRef} tabIndex={-1}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.01" />
      </svg>
      <div>
        <p className="tips-failure-title">{message.title}</p>
        <p>{message.detail}</p>
        <div className="tips-actions">
          {retryLabel && (
            <button type="button" className="tips-secondary" onClick={onRetry}>
              {retryLabel}
            </button>
          )}
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
