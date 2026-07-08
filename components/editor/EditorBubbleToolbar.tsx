'use client'

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from 'react'
import { createPortal } from 'react-dom'
import { type Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  MoreHorizontal,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
  X,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import {
  editorToolbarIconButtonClass,
  editorToolbarIconButtonState,
  editorToolbarPillClass,
} from './editorToolbarUi'

interface Props {
  editor: Editor | null
}

type TextAlignValue = 'left' | 'center' | 'right' | 'justify'
type HeadingLevel = 2 | 3

function canSetTextAlign(editor: Editor, align: TextAlignValue): boolean {
  const chain = editor.can().chain().focus() as {
    setTextAlign?: (a: string) => { run: () => boolean }
  }
  if (typeof chain.setTextAlign !== 'function') return false
  return chain.setTextAlign(align).run()
}

function setTextAlign(editor: Editor, align: TextAlignValue): void {
  const chain = editor.chain().focus() as {
    setTextAlign?: (a: string) => { run: () => boolean }
  }
  chain.setTextAlign?.(align).run()
}

function toggleHeading(editor: Editor, level: HeadingLevel): void {
  const chain = editor.chain().focus() as {
    toggleHeading?: (options: { level: HeadingLevel }) => { run: () => boolean }
  }
  chain.toggleHeading?.({ level }).run()
}

export function EditorBubbleToolbar({ editor }: Props) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [clampedLeft, setClampedLeft] = useState<number | null>(null)
  const [linkInput, setLinkInput] = useState<string | false>(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const recalc = useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      setVisible(false)
      setClampedLeft(null)
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      setVisible(false)
      setClampedLeft(null)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    if (!rect.width && !rect.height) {
      setVisible(false)
      setClampedLeft(null)
      return
    }
    setPos({
      top: Math.max(8, rect.top + window.scrollY - 48),
      left: rect.left + window.scrollX + rect.width / 2,
    })
    setClampedLeft(null)
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

  useLayoutEffect(() => {
    if (!visible || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const margin = 8
    const halfWidth = rect.width / 2
    const centerX = pos.left
    const minCenter = margin + halfWidth
    const maxCenter = window.innerWidth - margin - halfWidth
    if (centerX < minCenter) {
      setClampedLeft(minCenter)
    } else if (centerX > maxCenter) {
      setClampedLeft(maxCenter)
    }
  }, [visible, pos, linkInput])

  useEffect(() => {
    if (linkInput !== false) {
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [linkInput])

  if (!visible || !editor || typeof document === 'undefined') return null

  const stop = (e: React.MouseEvent) => e.preventDefault()

  const runAlign = (align: TextAlignValue) => {
    if (!canSetTextAlign(editor, align)) return
    setTextAlign(editor, align)
  }

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
        editorToolbarIconButtonClass,
        editorToolbarIconButtonState(active)
      )}
    >
      {icon}
    </button>
  )

  const overflowItemClass = (active = false) =>
    cn(
      'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none hover:bg-muted focus:bg-muted',
      active && 'bg-muted font-medium text-primary'
    )

  const displayLeft = clampedLeft ?? pos.left

  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: pos.top,
        left: displayLeft,
        transform: 'translateX(-50%)',
        zIndex: 60,
      }}
    >
      <div className={editorToolbarPillClass}>
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
              className="w-48 bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none sm:w-52"
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
              aria-label="Cancel link"
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
                editorToolbarIconButtonClass,
                editorToolbarIconButtonState(editor.isActive('link'))
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
            <div className="w-px self-stretch bg-border" />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  title="More formatting"
                  aria-label="More formatting"
                  onMouseDown={stop}
                  className={cn(
                    editorToolbarIconButtonClass,
                    'text-foreground'
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-[70] min-w-[180px] rounded-lg border border-border bg-popover py-1 shadow-lg"
                  sideOffset={6}
                  align="center"
                >
                  <DropdownMenu.Item
                    onSelect={() => toggleHeading(editor, 2)}
                    className={overflowItemClass(
                      editor.isActive('heading', { level: 2 })
                    )}
                  >
                    <Heading2 className="h-4 w-4 shrink-0" />
                    Heading 2
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => toggleHeading(editor, 3)}
                    className={overflowItemClass(
                      editor.isActive('heading', { level: 3 })
                    )}
                  >
                    <Heading3 className="h-4 w-4 shrink-0" />
                    Heading 3
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item
                    onSelect={() =>
                      editor.chain().focus().toggleUnderline().run()
                    }
                    className={overflowItemClass(editor.isActive('underline'))}
                  >
                    <UnderlineIcon className="h-4 w-4 shrink-0" />
                    Underline
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => editor.chain().focus().toggleStrike().run()}
                    className={overflowItemClass(editor.isActive('strike'))}
                  >
                    <Strikethrough className="h-4 w-4 shrink-0" />
                    Strikethrough
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => editor.chain().focus().toggleCode().run()}
                    className={overflowItemClass(editor.isActive('code'))}
                  >
                    <Code className="h-4 w-4 shrink-0" />
                    Inline code
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() =>
                      editor.chain().focus().toggleBlockquote().run()
                    }
                    className={overflowItemClass(editor.isActive('blockquote'))}
                  >
                    <Quote className="h-4 w-4 shrink-0" />
                    Blockquote
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className={overflowItemClass()}>
                      <AlignLeft className="h-4 w-4 shrink-0" />
                      Alignment
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        className="z-[70] min-w-[160px] rounded-lg border border-border bg-popover py-1 shadow-lg"
                        sideOffset={4}
                      >
                        {(
                          [
                            ['left', AlignLeft, 'Align left'],
                            ['center', AlignCenter, 'Align center'],
                            ['right', AlignRight, 'Align right'],
                            ['justify', AlignJustify, 'Justify'],
                          ] as const
                        ).map(([align, Icon, label]) => (
                          <DropdownMenu.Item
                            key={align}
                            disabled={!canSetTextAlign(editor, align)}
                            onSelect={() => runAlign(align)}
                            className={overflowItemClass(
                              editor.isActive({ textAlign: align })
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            {label}
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
