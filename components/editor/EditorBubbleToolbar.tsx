'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { type Editor } from '@tiptap/react'
import {
  Bold,
  Code,
  Italic,
  Link2,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  editor: Editor | null
}

export function EditorBubbleToolbar({ editor }: Props) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [linkInput, setLinkInput] = useState<string | false>(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const recalc = useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      setVisible(false)
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      setVisible(false)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    if (!rect.width && !rect.height) {
      setVisible(false)
      return
    }
    setPos({
      top: rect.top + window.scrollY - 52,
      left: rect.left + window.scrollX + rect.width / 2,
    })
    setVisible(true)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const handler = () => recalc()
    editor.on('selectionUpdate', handler)
    editor.on('transaction', handler)
    return () => {
      editor.off('selectionUpdate', handler)
      editor.off('transaction', handler)
    }
  }, [editor, recalc])

  // focus link input when it opens
  useEffect(() => {
    if (linkInput !== false) {
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [linkInput])

  if (!visible || !editor || typeof document === 'undefined') return null

  const stop = (e: React.MouseEvent) => e.preventDefault()

  const btn = (
    title: string,
    icon: React.ReactNode,
    action: () => void,
    active: boolean
  ) => (
    <button
      key={title}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={stop}
      onClick={action}
      className={cn(
        'px-2.5 py-2 transition-colors hover:bg-muted',
        active ? 'bg-muted text-primary' : 'text-foreground'
      )}
    >
      {icon}
    </button>
  )

  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        transform: 'translateX(-50%)',
        zIndex: 60,
      }}
    >
      <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        {linkInput !== false ? (
          <div className="flex items-center gap-1 px-2 py-1">
            <input
              ref={inputRef}
              type="url"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const url = linkInput.trim()
                  if (url) {
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange('link')
                      .setLink({ href: url })
                      .run()
                  }
                  setLinkInput(false)
                }
                if (e.key === 'Escape') {
                  setLinkInput(false)
                  editor.commands.focus()
                }
              }}
              placeholder="Paste URL and press Enter"
              className="w-52 bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              onMouseDown={stop}
              onClick={() => {
                setLinkInput(false)
                editor.commands.focus()
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            {btn(
              'Bold',
              <Bold className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleBold().run(),
              editor.isActive('bold')
            )}
            {btn(
              'Italic',
              <Italic className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleItalic().run(),
              editor.isActive('italic')
            )}
            {btn(
              'Underline',
              <UnderlineIcon className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleUnderline().run(),
              editor.isActive('underline')
            )}
            {btn(
              'Strikethrough',
              <Strikethrough className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleStrike().run(),
              editor.isActive('strike')
            )}
            {btn(
              'Inline code',
              <Code className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleCode().run(),
              editor.isActive('code')
            )}
            <div className="w-px self-stretch bg-border" />
            <button
              type="button"
              title="Heading 2"
              aria-label="Heading 2"
              aria-pressed={editor.isActive('heading', { level: 2 })}
              onMouseDown={stop}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              className={cn(
                'px-2.5 py-2 text-xs font-semibold transition-colors hover:bg-muted',
                editor.isActive('heading', { level: 2 })
                  ? 'bg-muted text-primary'
                  : 'text-foreground'
              )}
            >
              H2
            </button>
            <button
              type="button"
              title="Heading 3"
              aria-label="Heading 3"
              aria-pressed={editor.isActive('heading', { level: 3 })}
              onMouseDown={stop}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
              className={cn(
                'px-2.5 py-2 text-xs font-semibold transition-colors hover:bg-muted',
                editor.isActive('heading', { level: 3 })
                  ? 'bg-muted text-primary'
                  : 'text-foreground'
              )}
            >
              H3
            </button>
            <div className="w-px self-stretch bg-border" />
            {btn(
              'Blockquote',
              <Quote className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleBlockquote().run(),
              editor.isActive('blockquote')
            )}
            <button
              type="button"
              title={editor.isActive('link') ? 'Remove link' : 'Add link'}
              aria-label={editor.isActive('link') ? 'Remove link' : 'Add link'}
              aria-pressed={editor.isActive('link')}
              onMouseDown={stop}
              onClick={() => {
                if (editor.isActive('link')) {
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange('link')
                    .unsetLink()
                    .run()
                } else {
                  setLinkInput('')
                }
              }}
              className={cn(
                'px-2.5 py-2 transition-colors hover:bg-muted',
                editor.isActive('link')
                  ? 'bg-muted text-primary'
                  : 'text-foreground'
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
