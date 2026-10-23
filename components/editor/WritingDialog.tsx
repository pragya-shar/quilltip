'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { useRef, type ReactNode } from 'react'
import {
  articleAppearanceClasses,
  type ArticleStyle,
} from '@/lib/editor/articleAppearance'

export function WritingDialog({
  open,
  onClose,
  title,
  children,
  kind = 'small-dialog',
  appearance,
  modal = true,
  busy = false,
  header = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  kind?: string
  appearance: ArticleStyle
  modal?: boolean
  busy?: boolean
  header?: boolean
}) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose()
      }}
      modal={modal}
    >
      <Dialog.Portal>
        <div
          className={`writing-workspace writing-portal ${articleAppearanceClasses(appearance)}`}
        >
          <Dialog.Overlay className="writing-overlay" />
          <Dialog.Content
            className={`writer-dialog ${kind}`}
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              returnFocus.current = document.activeElement as HTMLElement
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              returnFocus.current?.focus()
            }}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault()
            }}
          >
            {header ? (
              <div className="drawer-header">
                <Dialog.Title>{title}</Dialog.Title>
                <button
                  aria-label={`Close ${title}`}
                  disabled={busy}
                  onClick={onClose}
                >
                  ×
                </button>
              </div>
            ) : (
              <Dialog.Title className="sr-only">{title}</Dialog.Title>
            )}
            {children}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
