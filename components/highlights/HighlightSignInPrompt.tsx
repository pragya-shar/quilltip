'use client'

import { useEffect, useId, useRef } from 'react'
import Link from 'next/link'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { Highlighter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useClampedFixedPosition } from '@/hooks/useClampedFixedPosition'
import { buildLoginHref, buildRegisterHref } from '@/lib/auth/safeReturnPath'
import { useHighlightPanelDismiss } from '@/hooks/useHighlightPanelDismiss'

interface HighlightSignInPromptProps {
  position: { top: number; left: number }
  selectedText: string
  returnPath: string
  onClose: () => void
  onRestoreFocus?: () => void
  onBeforeAuthNavigate?: () => void
}

export function HighlightSignInPrompt({
  position,
  selectedText,
  returnPath,
  onClose,
  onRestoreFocus,
  onBeforeAuthNavigate,
}: HighlightSignInPromptProps) {
  const titleId = useId()
  const descriptionId = useId()
  const promptRef = useRef<HTMLDivElement>(null)
  const clampedPosition = useClampedFixedPosition(position, promptRef, {
    fallbackWidth: 320,
    fallbackHeight: 220,
  })

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

  const handleAuthNavigate = () => {
    onBeforeAuthNavigate?.()
  }

  return (
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
        className="highlight-popover highlight-guest-prompt fixed z-50 w-[360px] max-w-[calc(100vw-24px)] p-5 outline-none"
        style={{
          top: clampedPosition.top,
          left: clampedPosition.left,
        }}
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
            <h2 id={titleId} className="highlight-panel-title">
              Sign in to save highlights
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-sm text-ui-muted-foreground"
            >
              Save passages you care about with personal highlights and notes.
              They stay on your account and show up in the article sidebar.
            </p>
          </div>
        </div>

        <div className="highlight-text-preview mb-4 text-sm">
          &ldquo;{preview}&rdquo;
        </div>

        <div className="flex flex-col gap-2">
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
  )
}
