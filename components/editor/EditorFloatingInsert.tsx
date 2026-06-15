'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { type Editor } from '@tiptap/react'
import {
  Code,
  Image as ImageIcon,
  List,
  ListOrdered,
  Plus,
  Quote,
  Youtube,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  editorInsertPlusButtonClass,
  editorToolbarIconButtonClass,
  editorToolbarPillClass,
} from './editorToolbarUi'

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

  const formatAction = (action: () => void) => () => {
    action()
    setOpen(false)
  }

  const iconBtn = (
    title: string,
    icon: React.ReactNode,
    action: () => void,
    active = false
  ) => (
    <button
      key={title}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={stop}
      onClick={formatAction(action)}
      className={cn(
        editorToolbarIconButtonClass,
        active ? 'bg-muted text-primary' : 'text-foreground'
      )}
    >
      {icon}
    </button>
  )

  const headingBtn = (level: 2 | 3, label: string) => (
    <button
      key={label}
      type="button"
      title={`Heading ${level}`}
      aria-label={`Heading ${level}`}
      aria-pressed={editor.isActive('heading', { level })}
      onMouseDown={stop}
      onClick={formatAction(() =>
        editor.chain().focus().toggleHeading({ level }).run()
      )}
      className={cn(
        editorToolbarIconButtonClass,
        'text-xs font-semibold',
        editor.isActive('heading', { level })
          ? 'bg-muted text-primary'
          : 'text-foreground'
      )}
    >
      {label}
    </button>
  )

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
        aria-expanded={open}
        onMouseDown={stop}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          editorInsertPlusButtonClass,
          open && 'border-primary text-primary'
        )}
      >
        <Plus
          className={cn('h-4 w-4 transition-transform', open && 'rotate-45')}
        />
      </button>

      {open && (
        <div className={cn(editorToolbarPillClass, 'rounded-2xl')}>
          <div
            className="flex items-center px-1"
            role="group"
            aria-label="Format"
          >
            {headingBtn(2, 'H2')}
            {headingBtn(3, 'H3')}
            {iconBtn(
              'Blockquote',
              <Quote className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleBlockquote().run(),
              editor.isActive('blockquote')
            )}
            {iconBtn(
              'Code block',
              <Code className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleCodeBlock().run(),
              editor.isActive('codeBlock')
            )}
            {iconBtn(
              'Bullet list',
              <List className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleBulletList().run(),
              editor.isActive('bulletList')
            )}
            {iconBtn(
              'Numbered list',
              <ListOrdered className="h-3.5 w-3.5" />,
              () => editor.chain().focus().toggleOrderedList().run(),
              editor.isActive('orderedList')
            )}
          </div>
          <div className="w-px self-stretch bg-border" />
          <div
            className="flex items-center px-1"
            role="group"
            aria-label="Media"
          >
            {iconBtn(
              'Insert image',
              <ImageIcon className="h-3.5 w-3.5" />,
              onInsertImage
            )}
            {iconBtn(
              'Embed YouTube',
              <Youtube className="h-3.5 w-3.5" />,
              onInsertYouTube
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
