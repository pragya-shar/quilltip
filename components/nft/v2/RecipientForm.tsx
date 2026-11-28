'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  checkRecipient,
  type RecipientCheck,
  type RecipientProblem,
  type RecipientInput,
} from '@/lib/stellar/v2/nft-calls'
import { TRANSFER_COPY } from '@/lib/copy/nft-v2'
import { isTouch } from './isTouch'

/** Problems shown as soon as they appear: the input is complete and wrong. */
const SHOW_AT_ONCE = new Set<RecipientProblem>([
  'checksum',
  'muxed',
  'secret',
  'own',
  'platform',
])

export function RecipientForm({
  owner,
  platformContracts,
  preparing,
  serverError,
  onSubmit,
  onCancel,
}: {
  owner: string
  platformContracts: readonly (string | null | undefined)[]
  preparing: boolean
  serverError: string | null
  onSubmit: (recipient: RecipientInput) => void
  onCancel: () => void
}) {
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  // Validate late: errors show after blur or submit, then follow each edit.
  const [shown, setShown] = useState(false)
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null)
  const check: RecipientCheck = checkRecipient(value, {
    owner,
    platformContracts,
  })

  useEffect(() => {
    if (!isTouch()) inputRef.current?.focus()
  }, [])
  // A server refusal returns focus to the field it is about.
  useEffect(() => {
    if (serverError) inputRef.current?.focus()
  }, [serverError])

  const localError =
    check.status === 'invalid' && (shown || SHOW_AT_ONCE.has(check.problem))
      ? check.message
      : check.status === 'incomplete' && shown
        ? check.message
        : check.status === 'empty' && shown && lastSubmitted !== null
          ? 'Enter a Stellar address or a username.'
          : null
  const error =
    localError ??
    (serverError && lastSubmitted === value.trim() ? serverError : null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (preparing) return
    setShown(true)
    setLastSubmitted(value.trim())
    if (check.status !== 'ok') {
      inputRef.current?.focus()
      return
    }
    onSubmit(check.recipient)
  }

  return (
    <form className="nft-v2-form" onSubmit={submit} noValidate>
      <div className="nft-v2-field">
        <label htmlFor={inputId} className="nft-v2-label">
          {TRANSFER_COPY.recipientLabel}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          name="recipient"
          type="text"
          inputMode="text"
          enterKeyHint="next"
          className="nft-v2-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (value.trim()) setShown(true)
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          placeholder="G… or @username"
        />
        <p id={hintId} className="nft-v2-note">
          {TRANSFER_COPY.recipientHint}
        </p>
        {error ? (
          <p id={errorId} className="nft-v2-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
      <div className="nft-v2-footer">
        <Button
          type="button"
          variant="outline"
          className="nft-button nft-button-secondary"
          onClick={onCancel}
        >
          {TRANSFER_COPY.cancel}
        </Button>
        <Button
          type="submit"
          className="nft-button nft-v2-primary"
          aria-disabled={preparing ? true : undefined}
        >
          {preparing ? 'Preparing…' : TRANSFER_COPY.review}
        </Button>
      </div>
    </form>
  )
}
