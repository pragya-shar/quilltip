'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { type Editor } from '@tiptap/react'
import { Code, Image as ImageIcon, Plus, Quote, Youtube } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  editor: Editor | null
  onInsertImage: () => void
  onInsertYouTube: () => void
}

export function EditorFloatingInsert({
  editor,
  onInsertImage,
  onInsertYouTube,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const recalc = useCallback(() => {
    if (!editor) {
      setVisible(false)
      return
    }
    const { selection } = editor.state
    const { $from } = selection
    const isEmptyParagraph =
      $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0

    if (!isEmptyParagraph) {
      setVisible(false)
      setOpen(false)
      return
    }

    try {
      const coords = editor.view.coordsAtPos($from.pos)
      setPos({
        top: coords.top + window.scrollY - 4,
        left: coords.left + window.scrollX - 40,
      })
      setVisible(true)
    } catch {
      setVisible(false)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', recalc)
    editor.on('transaction', recalc)
    return () => {
      editor.off('selectionUpdate', recalc)
      editor.off('transaction', recalc)
    }
  }, [editor, recalc])

  if (!visible || !editor || typeof document === 'undefined') return null

  const stop = (e: React.MouseEvent) => e.preventDefault()

  return createPortal(
    <div
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        zIndex: 50,
      }}
      className="flex items-center gap-1.5"
    >
      <button
        type="button"
        title={open ? 'Close' : 'Insert block'}
        aria-label={open ? 'Close' : 'Insert block'}
        onMouseDown={stop}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary',
          open && 'border-primary text-primary'
        )}
      >
        <Plus
          className={cn('h-4 w-4 transition-transform', open && 'rotate-45')}
        />
      </button>

      {open && (
        <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card shadow-md">
          {(
            [
              {
                title: 'Heading 2',
                label: 'H2',
                action: () => {
                  editor.chain().focus().toggleHeading({ level: 2 }).run()
                  setOpen(false)
                },
              },
              {
                title: 'Heading 3',
                label: 'H3',
                action: () => {
                  editor.chain().focus().toggleHeading({ level: 3 }).run()
                  setOpen(false)
                },
              },
            ] as const
          ).map(({ title, label, action }) => (
            <button
              key={title}
              type="button"
              title={title}
              aria-label={title}
              onMouseDown={stop}
              onClick={action}
              className="px-2.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              {label}
            </button>
          ))}
          <div className="w-px self-stretch bg-border" />
          <button
            type="button"
            title="Blockquote"
            aria-label="Blockquote"
            onMouseDown={stop}
            onClick={() => {
              editor.chain().focus().toggleBlockquote().run()
              setOpen(false)
            }}
            className="px-2.5 py-2 text-foreground transition-colors hover:bg-muted"
          >
            <Quote className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Code block"
            aria-label="Code block"
            onMouseDown={stop}
            onClick={() => {
              editor.chain().focus().toggleCodeBlock().run()
              setOpen(false)
            }}
            className="px-2.5 py-2 text-foreground transition-colors hover:bg-muted"
          >
            <Code className="h-3.5 w-3.5" />
          </button>
          <div className="w-px self-stretch bg-border" />
          <button
            type="button"
            title="Insert image"
            aria-label="Insert image"
            onMouseDown={stop}
            onClick={() => {
              onInsertImage()
              setOpen(false)
            }}
            className="px-2.5 py-2 text-foreground transition-colors hover:bg-muted"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Embed YouTube"
            aria-label="Embed YouTube"
            onMouseDown={stop}
            onClick={() => {
              onInsertYouTube()
              setOpen(false)
            }}
            className="px-2.5 py-2 text-foreground transition-colors hover:bg-muted"
          >
            <Youtube className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
