'use client'

import { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Link2,
  Image,
  Type,
  ChevronDown,
  Plus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  FileText,
  Tag,
  Youtube,
  MoreHorizontal,
} from 'lucide-react'
import { useEffect, useState, useRef, useLayoutEffect, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ImageUploadDialog } from './ImageUploadDialog'
import { YouTubeEmbedDialog } from './YouTubeEmbedDialog'

function useShortcutLabel() {
  const [isApple, setIsApple] = useState(false)

  useEffect(() => {
    const platform = navigator.platform?.toLowerCase() ?? ''
    const ua = navigator.userAgent?.toLowerCase() ?? ''
    setIsApple(
      platform.includes('mac') ||
        platform.includes('iphone') ||
        ua.includes('mac os')
    )
  }, [])

  return (key: string) => (isApple ? `⌘${key}` : `Ctrl+${key}`)
}

interface EditorToolbarProps {
  editor: Editor | null
  /** When Add icon is used to jump to a field */
  onFocusTitle?: () => void
  onFocusExcerpt?: () => void
  onFocusTags?: () => void
  onFocusCoverImage?: () => void
  notes?: string
  onNotesChange?: (value: string) => void
}

interface ToolbarButtonProps {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  children: React.ReactNode
  title?: string
  className?: string
  tabIndex?: number
  onFocus?: React.FocusEventHandler<HTMLButtonElement>
  toolbarKey?: string
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    {
      onClick,
      isActive = false,
      disabled = false,
      children,
      title,
      className = '',
      tabIndex,
      onFocus,
      toolbarKey,
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={title}
        tabIndex={tabIndex}
        onFocus={onFocus}
        data-toolbar-item="true"
        data-toolbar-key={toolbarKey}
        className={`
        p-2 rounded hover:bg-muted transition-colors shrink-0
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${isActive ? 'bg-muted text-primary' : 'text-foreground'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      >
        {children}
      </button>
    )
  }
)

function ToolbarDivider({ className = '' }: { className?: string }) {
  return (
    <div
      className={`w-px h-5 bg-border mx-0.5 shrink-0 ${className}`}
      aria-hidden
    />
  )
}

export function EditorToolbar({
  editor,
  onFocusTitle,
  onFocusExcerpt,
  onFocusTags,
  onFocusCoverImage,
  notes = '',
  onNotesChange,
}: EditorToolbarProps) {
  const shortcut = useShortcutLabel()
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [showImageDialog, setShowImageDialog] = useState(false)
  const [showYouTubeDialog, setShowYouTubeDialog] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [activeItemKey, setActiveItemKey] = useState<string>('heading')
  const linkAnchorRef = useRef<HTMLDivElement>(null)
  const imageDialogTriggerRef = useRef<HTMLButtonElement>(null)
  const youtubeDialogTriggerRef = useRef<HTMLButtonElement>(null)
  const [linkPopoverPos, setLinkPopoverPos] = useState<{
    top: number
    left: number
  } | null>(null)

  const toolbarItemSelector = '[data-toolbar-item="true"]'

  const isVisibleToolbarItem = (el: HTMLElement) => {
    // Hidden via Tailwind `hidden` => display:none => no client rects.
    if (el.getClientRects().length === 0) return false
    const style = window.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    return true
  }

  const getToolbarItems = () => {
    const root = toolbarRef.current
    if (!root) return []
    return Array.from(
      root.querySelectorAll<HTMLElement>(toolbarItemSelector)
    ).filter((el) => !el.hasAttribute('disabled') && isVisibleToolbarItem(el))
  }

  const syncRovingTabIndex = () => {
    const items = getToolbarItems()
    if (items.length === 0) return
    const activeIndex = Math.max(
      0,
      items.findIndex((el) => el.dataset.toolbarKey === activeItemKey)
    )
    items.forEach((el, i) => {
      el.tabIndex = i === activeIndex ? 0 : -1
    })
  }

  useLayoutEffect(() => {
    if (!showLinkInput) {
      setLinkPopoverPos(null)
      return
    }
    const el = linkAnchorRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setLinkPopoverPos({ top: r.bottom + 4, left: r.left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [showLinkInput])

  useLayoutEffect(() => {
    syncRovingTabIndex()
    // We intentionally do not include syncRovingTabIndex in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeItemKey,
    showNotes,
    showLinkInput,
    showImageDialog,
    showYouTubeDialog,
  ])

  useEffect(() => {
    const root = toolbarRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      syncRovingTabIndex()
    })
    ro.observe(root)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!editor) {
    return null
  }

  const addLink = () => {
    if (linkUrl) {
      editor.chain().focus().setLink({ href: linkUrl }).run()
      setLinkUrl('')
      setShowLinkInput(false)
    }
  }

  const removeLink = () => {
    editor.chain().focus().unsetLink().run()
  }

  const handleImageSelect = (url: string) => {
    editor.chain().focus().setResizableImage({ src: url }).run()
  }

  const headingOptions = [
    {
      level: 0,
      label: 'Paragraph',
      command: () => editor.chain().focus().setParagraph().run(),
    },
    {
      level: 1,
      label: 'Heading 1',
      command: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      level: 2,
      label: 'Heading 2',
      command: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      level: 3,
      label: 'Heading 3',
      command: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      level: 4,
      label: 'Heading 4',
      command: () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
    },
    {
      level: 5,
      label: 'Heading 5',
      command: () => editor.chain().focus().toggleHeading({ level: 5 }).run(),
    },
    {
      level: 6,
      label: 'Heading 6',
      command: () => editor.chain().focus().toggleHeading({ level: 6 }).run(),
    },
  ]

  const getCurrentHeading = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive('heading', { level: i })) {
        return `Heading ${i}`
      }
    }
    return 'Paragraph'
  }

  const setTextAlign = (align: 'left' | 'center' | 'right' | 'justify') => {
    const chain = editor.chain().focus() as {
      setTextAlign: (a: string) => { run: () => void }
    }
    if (typeof chain.setTextAlign === 'function') {
      chain.setTextAlign(align).run()
    }
  }

  const linkPopover =
    showLinkInput && linkPopoverPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed z-[100] bg-popover border border-border rounded-lg shadow-lg p-2 flex flex-wrap items-center gap-2 max-w-[min(100vw-1rem,24rem)]"
            style={{
              top: linkPopoverPos.top,
              left: (() => {
                if (typeof window === 'undefined') return linkPopoverPos.left
                const maxLeft = Math.max(8, window.innerWidth - 8 - 320)
                return Math.max(8, Math.min(linkPopoverPos.left, maxLeft))
              })(),
            }}
          >
            <input
              type="url"
              placeholder="Enter URL"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addLink()
                else if (e.key === 'Escape') {
                  setShowLinkInput(false)
                  setLinkUrl('')
                }
              }}
              className="flex-1 min-w-[12rem] px-2 py-1.5 border border-input bg-background text-foreground rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={addLink}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90 shrink-0"
            >
              Add
            </button>
          </div>,
          document.body
        )
      : null

  const handleToolbarFocusCapture: React.FocusEventHandler<HTMLDivElement> = (
    e
  ) => {
    const root = toolbarRef.current
    if (!root) return
    const target = e.target as HTMLElement | null
    if (!target) return
    const item = target.closest<HTMLElement>(toolbarItemSelector)
    if (!item || !root.contains(item)) return
    const key = item.dataset.toolbarKey
    if (key) setActiveItemKey(key)
  }

  const moveFocus = (delta: number) => {
    const items = getToolbarItems()
    if (items.length === 0) return
    const focused = document.activeElement as HTMLElement | null
    const currentIndex =
      focused && focused.matches(toolbarItemSelector)
        ? items.indexOf(focused)
        : items.findIndex((el) => el.dataset.toolbarKey === activeItemKey)
    const from = currentIndex >= 0 ? currentIndex : 0
    const next = (from + delta + items.length) % items.length
    const el = items[next]
    if (!el) return
    el.focus()
    const key = el.dataset.toolbarKey
    if (key) setActiveItemKey(key)
  }

  const focusEdge = (which: 'start' | 'end') => {
    const items = getToolbarItems()
    if (items.length === 0) return
    const el = which === 'start' ? items[0] : items[items.length - 1]
    if (!el) return
    el.focus()
    const key = el.dataset.toolbarKey
    if (key) setActiveItemKey(key)
  }

  const handleToolbarKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    e
  ) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const isInToolbarItem = !!target.closest(toolbarItemSelector)
    if (!isInToolbarItem) return

    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveFocus(-1)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveFocus(1)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusEdge('start')
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusEdge('end')
      return
    }

    const isActivation = e.key === 'Enter' || e.key === ' '
    if (!isActivation) return

    // Native <button> handles Enter/Space. For non-button elements we click defensively.
    if (target instanceof HTMLButtonElement) return
    e.preventDefault()
    target.click()
  }

  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

  return (
    <div className="bg-background w-full min-w-0 flex items-stretch min-h-[44px] py-2 gap-2">
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:thin]">
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="Editor formatting"
          onKeyDown={handleToolbarKeyDown}
          onFocusCapture={handleToolbarFocusCapture}
          className="inline-flex min-h-[44px] flex-nowrap items-center gap-0.5 justify-start"
        >
          {/* Paragraph / style dropdown */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                onMouseDown={(e) => e.preventDefault()}
                data-toolbar-item="true"
                data-toolbar-key="heading"
                tabIndex={-1}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded hover:bg-muted text-foreground text-sm shrink-0 ${focusRing}`}
              >
                <Type className="w-4 h-4 shrink-0" />
                <span>{getCurrentHeading()}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 z-50">
                {headingOptions.map((option) => (
                  <DropdownMenu.Item
                    key={option.level}
                    onSelect={option.command}
                    className="px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none"
                  >
                    {option.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <ToolbarDivider />

          {/* B I U */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title={`Bold (${shortcut('B')})`}
            tabIndex={-1}
            onFocus={() => setActiveItemKey('bold')}
            toolbarKey="bold"
          >
            <Bold className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title={`Italic (${shortcut('I')})`}
            tabIndex={-1}
            onFocus={() => setActiveItemKey('italic')}
            toolbarKey="italic"
          >
            <Italic className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            title="Underline"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('underline')}
            toolbarKey="underline"
          >
            <Underline className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive('strike')}
            title="Strikethrough"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('strike')}
            toolbarKey="strike"
          >
            <Strikethrough className="w-4 h-4" />
          </ToolbarButton>

          {/* Quote */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive('blockquote')}
            title="Blockquote"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('blockquote')}
            toolbarKey="blockquote"
          >
            <Quote className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Code block, lists */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive('codeBlock')}
            title="Code block"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('codeBlock')}
            toolbarKey="codeBlock"
          >
            <Code className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            title="Numbered list"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('orderedList')}
            toolbarKey="orderedList"
          >
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            title="Bullet list"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('bulletList')}
            toolbarKey="bulletList"
          >
            <List className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider className="hidden md:block" />

          {/* Alignment — md+ only */}
          <div className="hidden md:contents">
            <ToolbarButton
              onClick={() => setTextAlign('left')}
              isActive={editor.isActive({ textAlign: 'left' })}
              title="Align left"
              tabIndex={-1}
              onFocus={() => setActiveItemKey('alignLeft')}
              toolbarKey="alignLeft"
            >
              <AlignLeft className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => setTextAlign('center')}
              isActive={editor.isActive({ textAlign: 'center' })}
              title="Align center"
              tabIndex={-1}
              onFocus={() => setActiveItemKey('alignCenter')}
              toolbarKey="alignCenter"
            >
              <AlignCenter className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => setTextAlign('right')}
              isActive={editor.isActive({ textAlign: 'right' })}
              title="Align right"
              tabIndex={-1}
              onFocus={() => setActiveItemKey('alignRight')}
              toolbarKey="alignRight"
            >
              <AlignRight className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => setTextAlign('justify')}
              isActive={editor.isActive({ textAlign: 'justify' })}
              title="Justify"
              tabIndex={-1}
              onFocus={() => setActiveItemKey('alignJustify')}
              toolbarKey="alignJustify"
            >
              <AlignJustify className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarDivider />
          </div>

          {/* Add - dropdown: Article Title, Cover Image URL, Excerpt, Tags */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                data-toolbar-item="true"
                data-toolbar-key="add"
                tabIndex={-1}
                className={`p-2 rounded hover:bg-muted text-foreground transition-colors cursor-pointer shrink-0 ${focusRing}`}
                title="Add"
                aria-label="Add"
              >
                <Plus className="w-4 h-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 z-50 min-w-[200px]"
                sideOffset={4}
                align="start"
              >
                <DropdownMenu.Item
                  onSelect={() => onFocusCoverImage?.()}
                  className="px-4 py-2.5 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                >
                  <Image className="w-4 h-4 shrink-0" />
                  Cover Image
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => onFocusTitle?.()}
                  className="px-4 py-2.5 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                >
                  <Type className="w-4 h-4 shrink-0" />
                  Article Title
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => onFocusExcerpt?.()}
                  className="px-4 py-2.5 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  Article Excerpt
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => onFocusTags?.()}
                  className="px-4 py-2.5 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                >
                  <Tag className="w-4 h-4 shrink-0" />
                  Tags
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Link */}
          <div ref={linkAnchorRef} className="relative shrink-0">
            {editor.isActive('link') ? (
              <ToolbarButton
                onClick={removeLink}
                isActive
                title={`Remove link (${shortcut('K')})`}
                tabIndex={-1}
                onFocus={() => setActiveItemKey('linkRemove')}
                toolbarKey="linkRemove"
              >
                <Link2 className="w-4 h-4" />
              </ToolbarButton>
            ) : (
              <ToolbarButton
                onClick={() => setShowLinkInput(!showLinkInput)}
                title={`Insert link (${shortcut('K')})`}
                tabIndex={-1}
                onFocus={() => setActiveItemKey('linkInsert')}
                toolbarKey="linkInsert"
              >
                <Link2 className="w-4 h-4" />
              </ToolbarButton>
            )}
          </div>

          {/* More: alignment, image, YouTube on small screens */}
          <div className="md:hidden shrink-0">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  data-toolbar-item="true"
                  data-toolbar-key="more"
                  tabIndex={-1}
                  className={`p-2 rounded hover:bg-muted text-foreground transition-colors cursor-pointer shrink-0 ${focusRing}`}
                  title="More formatting"
                  aria-label="More formatting"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 z-50 min-w-[200px]"
                  sideOffset={4}
                  align="start"
                >
                  <DropdownMenu.Label className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    Alignment
                  </DropdownMenu.Label>
                  <DropdownMenu.Item
                    onSelect={() => setTextAlign('left')}
                    className="px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                  >
                    <AlignLeft className="w-4 h-4 shrink-0" />
                    Align left
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setTextAlign('center')}
                    className="px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                  >
                    <AlignCenter className="w-4 h-4 shrink-0" />
                    Align center
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setTextAlign('right')}
                    className="px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                  >
                    <AlignRight className="w-4 h-4 shrink-0" />
                    Align right
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setTextAlign('justify')}
                    className="px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                  >
                    <AlignJustify className="w-4 h-4 shrink-0" />
                    Justify
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="h-px bg-border my-1" />
                  <DropdownMenu.Item
                    onSelect={() => setShowImageDialog(true)}
                    className="px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                  >
                    <Image className="w-4 h-4 shrink-0" />
                    Insert image
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setShowYouTubeDialog(true)}
                    className="px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2"
                  >
                    <Youtube className="w-4 h-4 shrink-0" />
                    Embed YouTube
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          {/* Image */}
          <ToolbarButton
            ref={imageDialogTriggerRef}
            onClick={() => setShowImageDialog(true)}
            title="Insert image"
            className="hidden md:inline-flex"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('image')}
            toolbarKey="image"
          >
            <Image className="w-4 h-4" />
          </ToolbarButton>

          {/* YouTube embed */}
          <ToolbarButton
            ref={youtubeDialogTriggerRef}
            onClick={() => setShowYouTubeDialog(true)}
            title="Embed YouTube video"
            className="hidden md:inline-flex"
            tabIndex={-1}
            onFocus={() => setActiveItemKey('youtube')}
            toolbarKey="youtube"
          >
            <Youtube className="w-4 h-4" />
          </ToolbarButton>
        </div>
      </div>

      {linkPopover}

      <div className="flex shrink-0 items-center border-l border-border pl-2">
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            data-toolbar-item="true"
            data-toolbar-key="notes"
            tabIndex={-1}
            className={`flex items-center gap-2 pl-3 pr-2 py-2 rounded hover:bg-muted text-sm font-medium ${focusRing} ${showNotes ? 'bg-muted text-primary' : 'text-foreground'}`}
            title="Notes"
            onClick={() => setShowNotes(!showNotes)}
          >
            <FileText className="w-4 h-4" />
            Notes
          </button>
          {showNotes && (
            <div className="absolute top-full right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 w-72">
              <div className="px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground">
                Personal Notes
              </div>
              <textarea
                value={notes}
                onChange={(e) => onNotesChange?.(e.target.value)}
                placeholder="Jot down ideas, reminders, or notes..."
                className="w-full p-3 text-sm text-foreground bg-popover placeholder:text-muted-foreground resize-none focus:outline-none rounded-b-lg"
                rows={6}
              />
            </div>
          )}
        </div>
      </div>

      <ImageUploadDialog
        isOpen={showImageDialog}
        onClose={() => setShowImageDialog(false)}
        onImageSelect={handleImageSelect}
        triggerRef={imageDialogTriggerRef}
      />

      <YouTubeEmbedDialog
        isOpen={showYouTubeDialog}
        onClose={() => setShowYouTubeDialog(false)}
        triggerRef={youtubeDialogTriggerRef}
        onVideoEmbed={(url, width, height) => {
          const chain = editor.chain().focus() as {
            setYoutubeVideo: (opts: {
              src: string
              width?: number
              height?: number
            }) => { run: () => void }
          }
          if (typeof chain.setYoutubeVideo === 'function') {
            chain.setYoutubeVideo({ src: url, width, height }).run()
          }
          setShowYouTubeDialog(false)
        }}
      />
    </div>
  )
}
