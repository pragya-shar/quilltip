'use client'

import { useEffect, useId, useRef } from 'react'
import Link from 'next/link'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { Highlighter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useClampedFixedPosition } from '@/hooks/useClampedFixedPosition'

interface HighlightSignInPromptProps {
  position: { top: number; left: number }
  selectedText: string
  onClose: () => void
}

export function HighlightSignInPrompt({
  position,
  selectedText,
  onClose,
}: HighlightSignInPromptProps) {
  const titleId = useId()
  const descriptionId = useId()
  const promptRef = useRef<HTMLDivElement>(null)
  const clampedPosition = useClampedFixedPosition(position, promptRef, {
    fallbackWidth: 320,
    fallbackHeight: 220,
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  useEffect(() => {
    promptRef.current?.focus()
  }, [])

  const preview =
    selectedText.length > 150
      ? `${selectedText.slice(0, 150)}...`
      : selectedText

  return (
    <FocusScope trapped loop>
      <div
        ref={promptRef}
        className="highlight-popover fixed z-50 w-[320px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-background p-4 shadow-lg outline-none"
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
            className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue"
            aria-hidden
          />
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-foreground">
              Sign in to save highlights
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-sm text-muted-foreground"
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
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            New here?{' '}
            <Link
              href="/register"
              className="font-medium text-brand-blue hover:text-brand-accent transition-colors"
            >
              Create a free account
            </Link>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-1 text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </FocusScope>
  )
}
