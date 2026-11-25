'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '@/convex/_generated/api'
import { track } from '@/lib/analytics/track'

const CATEGORIES = [
  { value: 'bug', label: 'Something isn’t working' },
  { value: 'idea', label: 'An idea or request' },
  { value: 'question', label: 'A question' },
  { value: 'other', label: 'Something else' },
] as const
type Category = (typeof CATEGORIES)[number]['value']

const MIN = 10
const MAX = 2000

export function FeedbackForm({ fromPath }: { fromPath?: string }) {
  const submit = useMutation(api.feedback.submit)
  const formRef = useRef<HTMLFormElement>(null)
  const sentRef = useRef<HTMLHeadingElement>(null)
  const [category, setCategory] = useState<Category>('bug')
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  // Move focus to the confirmation once it has rendered.
  useEffect(() => {
    if (sent) sentRef.current?.focus()
  }, [sent])

  const validate = (value: string) =>
    value.trim().length < MIN
      ? `Write at least ${MIN} characters so we can act on it.`
      : null

  async function onSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (submitting) return
    const error = validate(message)
    setMessageError(error)
    if (error) {
      formRef.current
        ?.querySelector<HTMLTextAreaElement>('#feedback-message')
        ?.focus()
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await submit({ category, message, pagePath: fromPath })
      track('feedback_sent', { category })
      setSent(true)
      setMessage('')
    } catch (e) {
      setFormError(
        e instanceof ConvexError && typeof e.data === 'string'
          ? e.data
          : 'We couldn’t send that. Check your connection and try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (sent)
    return (
      <div className="account-feedback-sent" role="status">
        <h2 ref={sentRef} tabIndex={-1}>
          Thanks. We read every message.
        </h2>
        <p className="account-muted">
          We can’t reply to each one, but your note goes straight to the people
          building QuillTip.
        </p>
        <button
          type="button"
          className="account-secondary"
          onClick={() => setSent(false)}
        >
          Send more feedback
        </button>
      </div>
    )

  return (
    <form
      ref={formRef}
      className="account-feedback"
      noValidate
      onSubmit={onSubmit}
      aria-busy={submitting}
    >
      {formError && (
        <p className="account-feedback-error" role="alert">
          {formError}
        </p>
      )}
      <fieldset>
        <legend>What is it about?</legend>
        {CATEGORIES.map((option) => (
          <label key={option.value} className="account-feedback-option">
            <input
              type="radio"
              name="category"
              value={option.value}
              checked={category === option.value}
              onChange={() => setCategory(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="account-feedback-field">
        <label htmlFor="feedback-message">Tell us more</label>
        <textarea
          id="feedback-message"
          rows={6}
          maxLength={MAX}
          value={message}
          aria-invalid={!!messageError}
          aria-describedby={`feedback-hint${messageError ? ' feedback-message-error' : ''}`}
          onChange={(e) => {
            setMessage(e.target.value)
            if (messageError) setMessageError(validate(e.target.value))
          }}
          onBlur={() => {
            if (message) setMessageError(validate(message))
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void onSubmit()
            }
          }}
        />
        {messageError && (
          <p id="feedback-message-error" className="account-feedback-error">
            {messageError}
          </p>
        )}
        <p id="feedback-hint" className="account-muted account-feedback-hint">
          <span>
            Leave out passwords, wallet secret keys and other private details.
          </span>
          <span aria-hidden="true" className="account-feedback-count">
            {message.length.toLocaleString('en-US')} /{' '}
            {MAX.toLocaleString('en-US')}
          </span>
        </p>
      </div>
      <button
        type="submit"
        className="account-primary"
        disabled={submitting}
        title="Send (Ctrl or ⌘ + Enter)"
      >
        {submitting ? 'Sending…' : 'Send feedback'}
      </button>
    </form>
  )
}
