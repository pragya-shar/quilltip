'use client'

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { Highlighter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HighlightPaperSlip } from './HighlightPaperSlip'
import { buildLoginHref, buildRegisterHref } from '@/lib/auth/safeReturnPath'
import { useHighlightPanelDismiss } from '@/hooks/useHighlightPanelDismiss'

interface HighlightSignInPromptProps {
  position: { top: number; left: number }
  selectedText: string
  returnPath: string
  onClose: () => void
  onRestoreFocus?: () => void
  onBeforeAuthNavigate?: () => boolean | void
}

export function HighlightSignInPrompt({
  selectedText,
  returnPath,
  onClose,
  onRestoreFocus,
  onBeforeAuthNavigate,
}: HighlightSignInPromptProps) {
  const titleId = useId()
  const [storageError, setStorageError] = useState(false)
  const descriptionId = useId()
  const promptRef = useRef<HTMLDivElement>(null)

  useHighlightPanelDismiss(onClose)

  useEffect(() => {
    promptRef.current?.focus()
  }, [])

  const preview =
    selectedText.length > 150
      ? `${selectedText.slice(0, 150)}...`
      : selectedText

  const loginHref = buildLoginHref(returnPath)
  const registerHref = buildRegisterHref(returnPath)

  const handleAuthNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (onBeforeAuthNavigate?.() === false) {
      event.preventDefault()
      setStorageError(true)
    }
  }

  return (
    <HighlightPaperSlip>
      <FocusScope
        trapped
        loop
        onUnmountAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus?.()
        }}
      >
        <div
          ref={promptRef}
          className="highlight-popover passage-slip highlight-guest-prompt fixed z-50 w-[560px] max-w-[calc(100vw-24px)] outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
        >
          <div className="mb-3 flex items-start gap-2">
            <Highlighter
              className="mt-0.5 h-5 w-5 shrink-0 text-ui-primary"
              aria-hidden
            />
            <div>
              <h2 id={titleId} className="slip-title">
                Sign in to save highlights
              </h2>
              <p
                id={descriptionId}
                className="mt-2 text-sm text-ui-muted-foreground"
              >
                Highlighting is free. Sign in to keep these words on your
                account. Your selected passage will be kept when you return.
              </p>
            </div>
          </div>

          <div className="highlight-text-preview mb-4 text-sm">
            &ldquo;{preview}&rdquo;
          </div>

          <div className="flex flex-col gap-2">
            {storageError && (
              <p role="alert" className="slip-error">
                Browser storage is unavailable. Your words are still here;
                enable session storage and try again.
              </p>
            )}
            <Button asChild className="w-full min-h-11">
              <Link href={loginHref} onClick={handleAuthNavigate}>
                Sign in
              </Link>
            </Button>
            <p className="text-center text-sm text-ui-muted-foreground">
              New here?{' '}
              <Link
                href={registerHref}
                onClick={handleAuthNavigate}
                className="inline-block py-3 font-medium text-ui-primary underline underline-offset-4"
              >
                Create a free account
              </Link>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="highlight-quiet-action w-full"
            >
              Not now
            </button>
          </div>
        </div>
      </FocusScope>
    </HighlightPaperSlip>
  )
}
