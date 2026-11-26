'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '@/convex/_generated/api'
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  handleFormatError,
  isGeneratedHandle,
} from '@/lib/profile/handleRules'
import { SITE_HOST } from '@/lib/profile/profileUrl'

const CHECK_DELAY_MS = 300

/** Step 1: choose a handle, pre-filled with a free one made from the name. */
export function WelcomeHandleStep({
  currentHandle,
  onDone,
}: {
  currentHandle: string
  onDone: () => void
}) {
  const suggestion = useQuery(api.handles.suggestHandle, {})
  const changeHandle = useMutation(api.handles.changeHandle)
  const [value, setValue] = useState<string | null>(null)
  const [checked, setChecked] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Until the writer types, show the suggestion (or a handle they chose before).
  const fallback =
    suggestion?.handle ??
    (isGeneratedHandle(currentHandle) ? '' : currentHandle)
  const handle = (value ?? (suggestion === undefined ? '' : fallback)).trim()

  useEffect(() => {
    const timer = setTimeout(() => setChecked(handle), CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [handle])

  const formatError = handleFormatError(handle)
  const status = useQuery(
    api.handles.checkHandle,
    !formatError && checked === handle ? { handle } : 'skip'
  )
  const showFormatError =
    Boolean(formatError) && (submitted || handle.length >= HANDLE_MIN_LENGTH)
  const taken = status?.status === 'taken'
  const invalid = showFormatError || taken || Boolean(serverError)

  let message: string
  let tone: 'good' | 'bad' | 'neutral' = 'neutral'
  if (serverError) {
    message = serverError
    tone = 'bad'
  } else if (showFormatError && formatError) {
    message = formatError
    tone = 'bad'
  } else if (!handle) {
    message = `Letters, numbers and underscores, ${HANDLE_MIN_LENGTH} to ${HANDLE_MAX_LENGTH} characters.`
  } else if (formatError) {
    message = `Keep going: at least ${HANDLE_MIN_LENGTH} characters.`
  } else if (status === undefined) {
    message = 'Checking…'
  } else if (status.status === 'available' || status.status === 'current') {
    message = `${SITE_HOST}/${handle} is yours to take.`
    tone = 'good'
  } else if (status.status === 'taken') {
    message = 'That handle is taken. Try adding a number or an underscore.'
    tone = 'bad'
  } else {
    message = status.message
    tone = 'bad'
  }

  async function submit() {
    if (saving) return
    setSubmitted(true)
    setServerError(null)
    if (formatError || taken) return inputRef.current?.focus()
    if (handle === currentHandle) return onDone()
    if (status?.status !== 'available') return

    setSaving(true)
    try {
      await changeHandle({ handle })
      onDone()
    } catch (error) {
      setServerError(
        error instanceof ConvexError && typeof error.data === 'string'
          ? error.data
          : 'Your handle wasn’t saved. Check your connection and try again.'
      )
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="settings-form welcome-form"
      noValidate
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="settings-field">
        <label htmlFor="welcome-handle">Handle</label>
        {/* Clicking the prefix focuses the input too. */}
        <label
          className="settings-prefixed"
          htmlFor="welcome-handle"
          data-invalid={invalid || undefined}
        >
          <span aria-hidden>{SITE_HOST}/</span>
          <input
            ref={inputRef}
            id="welcome-handle"
            name="handle"
            value={value ?? (suggestion === undefined ? '' : fallback)}
            placeholder="your_handle"
            maxLength={HANDLE_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            aria-invalid={invalid}
            aria-describedby="welcome-handle-status welcome-handle-hint"
            onChange={(event) => {
              setServerError(null)
              setValue(event.target.value)
            }}
          />
        </label>
        <p
          id="welcome-handle-status"
          role="status"
          className={
            tone === 'bad' ? 'settings-error' : 'settings-hint settings-status'
          }
          data-tone={tone}
        >
          {message}
        </p>
        <p id="welcome-handle-hint" className="settings-hint">
          Your handle is in your profile and article links. You can change it
          later in Settings, and old links keep working.
        </p>
      </div>
      <button type="submit" className="settings-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Continue'}
      </button>
    </form>
  )
}
