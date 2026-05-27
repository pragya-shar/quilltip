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
import {
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  forwardRef,
} from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { ImageUploadDialog } from './ImageUploadDialog'
import { YouTubeEmbedDialog } from './YouTubeEmbedDialog'
import {
  WRITER_NOTES_HELPER_TEXT,
  WriterNotesPanel,
} from './WriterNotesPanel'
import {
  getVisibleToolbarKeys,
  resolveActiveToolbarKey,
} from './editorToolbarKeys'

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
        aria-pressed={isActive}
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

function moreMenuItemClass(isActive: boolean) {
  return cn(
    'px-4 py-2 text-sm hover:bg-muted cursor-pointer outline-none flex items-center gap-2',
    isActive && 'bg-muted font-medium text-primary'
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
  const notesTriggerRef = useRef<HTMLButtonElement>(null)
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [linkPopoverPos, setLinkPopoverPos] = useState<{
    top: number
    left: number
  } | null>(null)

  const toolbarItemSelector = '[data-toolbar-item="true"]'
  const isMobile = useIsMobile()
  const isLinkActive = editor?.isActive('link') ?? false
  const visibleKeys = getVisibleToolbarKeys(isMobile, isLinkActive)
  const effectiveActiveKey = resolveActiveToolbarKey(activeItemKey, visibleKeys)

  const tabIndexFor = (key: string) => (key === effectiveActiveKey ? 0 : -1)

  const focusToolbarKey = (key: string) => {
    const root = toolbarRef.current
    if (!root) return
    const el = root.querySelector<HTMLElement>(`[data-toolbar-key="${key}"]`)
    el?.focus()
  }

  useEffect(() => {
    const keys = getVisibleToolbarKeys(isMobile, isLinkActive)
    if (!keys.includes(activeItemKey)) {
      setActiveItemKey(resolveActiveToolbarKey(activeItemKey, keys))
    }
  }, [isMobile, isLinkActive, activeItemKey])

  const handleNotesOpenChange = useCallback((open: boolean) => {
    setShowNotes(open)
    if (!open) {
      requestAnimationFrame(() => {
        notesTriggerRef.current?.focus()
      })
    }
  }, [])

  useEffect(() => {
    if (!showNotes || !isMobile) return
    const frame = requestAnimationFrame(() => {
      notesTextareaRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [showNotes, isMobile])

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
    if (visibleKeys.length === 0) return
    const currentIndex = visibleKeys.indexOf(effectiveActiveKey)
    const from = currentIndex >= 0 ? currentIndex : 0
    const nextKey =
      visibleKeys[(from + delta + visibleKeys.length) % visibleKeys.length]
    if (!nextKey) return
    setActiveItemKey(nextKey)
    focusToolbarKey(nextKey)
  }

  const focusEdge = (which: 'start' | 'end') => {
    const nextKey =
      which === 'start' ? visibleKeys[0] : visibleKeys[visibleKeys.length - 1]
    if (!nextKey) return
    setActiveItemKey(nextKey)
    focusToolbarKey(nextKey)
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

    if (target instanceof HTMLButtonElement) return
    e.preventDefault()
    target.click()
  }

  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

  const currentHeading = getCurrentHeading()

  const headingDropdown = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          data-toolbar-item="true"
          data-toolbar-key="heading"
          tabIndex={tabIndexFor('heading')}
          aria-label={currentHeading}
          title={currentHeading}
          className={`flex items-center gap-1.5 px-2.5 py-2 rounded hover:bg-muted text-foreground text-sm shrink-0 ${focusRing}`}
        >
          <Type className="w-4 h-4 shrink-0" />
          <span className="hidden md:inline">{currentHeading}</span>
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
  )

  const addMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          data-toolbar-item="true"
          data-toolbar-key="add"
          tabIndex={tabIndexFor('add')}
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
  )

  const linkControl = (
    <div ref={linkAnchorRef} className="relative shrink-0">
      {editor.isActive('link') ? (
        <ToolbarButton
          onClick={removeLink}
          isActive
          title={`Remove link (${shortcut('K')})`}
          tabIndex={tabIndexFor('linkRemove')}
          onFocus={() => setActiveItemKey('linkRemove')}
          toolbarKey="linkRemove"
        >
          <Link2 className="w-4 h-4" />
        </ToolbarButton>
      ) : (
        <ToolbarButton
          onClick={() => setShowLinkInput(!showLinkInput)}
          title={`Insert link (${shortcut('K')})`}
          tabIndex={tabIndexFor('linkInsert')}
          onFocus={() => setActiveItemKey('linkInsert')}
          toolbarKey="linkInsert"
        >
          <Link2 className="w-4 h-4" />
        </ToolbarButton>
      )}
    </div>
  )

  const moreMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          data-toolbar-item="true"
          data-toolbar-key="more"
          tabIndex={tabIndexFor('more')}
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
          align="end"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Alignment
          </DropdownMenu.Label>
          <DropdownMenu.Item
            onSelect={() => setTextAlign('left')}
            className={moreMenuItemClass(
              editor.isActive({ textAlign: 'left' })
            )}
          >
            <AlignLeft className="w-4 h-4 shrink-0" />
            Align left
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setTextAlign('center')}
            className={moreMenuItemClass(
              editor.isActive({ textAlign: 'center' })
            )}
          >
            <AlignCenter className="w-4 h-4 shrink-0" />
            Align center
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setTextAlign('right')}
            className={moreMenuItemClass(
              editor.isActive({ textAlign: 'right' })
            )}
          >
            <AlignRight className="w-4 h-4 shrink-0" />
            Align right
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setTextAlign('justify')}
            className={moreMenuItemClass(
              editor.isActive({ textAlign: 'justify' })
            )}
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
  )

  const notesTriggerButton = (
    <button
      ref={notesTriggerRef}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      data-toolbar-item="true"
      data-toolbar-key="notes"
      tabIndex={tabIndexFor('notes')}
      className={`flex items-center gap-1.5 rounded px-2 py-2 text-sm font-medium hover:bg-muted md:gap-2 md:pl-3 md:pr-2 ${focusRing} ${showNotes ? 'bg-muted text-primary' : 'text-foreground'}`}
      title="Notes"
      aria-label="Notes"
      aria-expanded={showNotes}
      onClick={() => {
        if (isMobile) {
          setShowNotes(true)
        } else {
          setShowNotes((open) => !open)
        }
      }}
      onFocus={() => setActiveItemKey('notes')}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="hidden min-[360px]:inline md:inline">Notes</span>
    </button>
  )

  const notesControl = isMobile ? (
    <Drawer open={showNotes} onOpenChange={handleNotesOpenChange}>
      {notesTriggerButton}
      <DrawerContent
        className="max-h-[min(70dvh,32rem)] gap-0 overflow-y-auto px-0 pb-6"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          notesTextareaRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          notesTriggerRef.current?.focus()
        }}
      >
        <DrawerHeader className="space-y-0 px-4 pb-2 text-left">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 space-y-1">
              <DrawerTitle className="text-base">Personal Notes</DrawerTitle>
              <DrawerDescription className="text-left text-xs leading-snug">
                {WRITER_NOTES_HELPER_TEXT}
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <button
                type="button"
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-primary hover:bg-muted',
                  focusRing
                )}
              >
                Done
              </button>
            </DrawerClose>
          </div>
        </DrawerHeader>
        <WriterNotesPanel
          ref={notesTextareaRef}
          notes={notes}
          onNotesChange={onNotesChange}
          showHeader={false}
          textareaClassName="min-h-[8rem] rounded-none border-0 bg-background"
        />
      </DrawerContent>
    </Drawer>
  ) : (
    <div className="relative">
      {notesTriggerButton}
      {showNotes ? (
        <div
          className="absolute top-full right-0 z-50 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
          role="dialog"
          aria-label="Personal notes"
        >
          <WriterNotesPanel
            ref={notesTextareaRef}
            notes={notes}
            onNotesChange={onNotesChange}
            textareaClassName="rounded-b-lg"
          />
        </div>
      ) : null}
    </div>
  )

  const formattingControls = (
    <>
      {headingDropdown}
      <ToolbarDivider />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title={`Bold (${shortcut('B')})`}
        tabIndex={tabIndexFor('bold')}
        onFocus={() => setActiveItemKey('bold')}
        toolbarKey="bold"
      >
        <Bold className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title={`Italic (${shortcut('I')})`}
        tabIndex={tabIndexFor('italic')}
        onFocus={() => setActiveItemKey('italic')}
        toolbarKey="italic"
      >
        <Italic className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline"
        tabIndex={tabIndexFor('underline')}
        onFocus={() => setActiveItemKey('underline')}
        toolbarKey="underline"
      >
        <Underline className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
        tabIndex={tabIndexFor('strike')}
        onFocus={() => setActiveItemKey('strike')}
        toolbarKey="strike"
      >
        <Strikethrough className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="Blockquote"
        tabIndex={tabIndexFor('blockquote')}
        onFocus={() => setActiveItemKey('blockquote')}
        toolbarKey="blockquote"
      >
        <Quote className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive('codeBlock')}
        title="Code block"
        tabIndex={tabIndexFor('codeBlock')}
        onFocus={() => setActiveItemKey('codeBlock')}
        toolbarKey="codeBlock"
      >
        <Code className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Numbered list"
        tabIndex={tabIndexFor('orderedList')}
        onFocus={() => setActiveItemKey('orderedList')}
        toolbarKey="orderedList"
      >
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet list"
        tabIndex={tabIndexFor('bulletList')}
        onFocus={() => setActiveItemKey('bulletList')}
        toolbarKey="bulletList"
      >
        <List className="w-4 h-4" />
      </ToolbarButton>
    </>
  )

  const desktopAlignmentControls = (
    <div className="hidden md:contents">
      <ToolbarDivider />
      <ToolbarButton
        onClick={() => setTextAlign('left')}
        isActive={editor.isActive({ textAlign: 'left' })}
        title="Align left"
        tabIndex={tabIndexFor('alignLeft')}
        onFocus={() => setActiveItemKey('alignLeft')}
        toolbarKey="alignLeft"
      >
        <AlignLeft className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => setTextAlign('center')}
        isActive={editor.isActive({ textAlign: 'center' })}
        title="Align center"
        tabIndex={tabIndexFor('alignCenter')}
        onFocus={() => setActiveItemKey('alignCenter')}
        toolbarKey="alignCenter"
      >
        <AlignCenter className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => setTextAlign('right')}
        isActive={editor.isActive({ textAlign: 'right' })}
        title="Align right"
        tabIndex={tabIndexFor('alignRight')}
        onFocus={() => setActiveItemKey('alignRight')}
        toolbarKey="alignRight"
      >
        <AlignRight className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => setTextAlign('justify')}
        isActive={editor.isActive({ textAlign: 'justify' })}
        title="Justify"
        tabIndex={tabIndexFor('alignJustify')}
        onFocus={() => setActiveItemKey('alignJustify')}
        toolbarKey="alignJustify"
      >
        <AlignJustify className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarDivider />
    </div>
  )

  const desktopMediaControls = (
    <>
      <ToolbarButton
        ref={imageDialogTriggerRef}
        onClick={() => setShowImageDialog(true)}
        title="Insert image"
        className="hidden md:inline-flex"
        tabIndex={tabIndexFor('image')}
        onFocus={() => setActiveItemKey('image')}
        toolbarKey="image"
      >
        <Image className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        ref={youtubeDialogTriggerRef}
        onClick={() => setShowYouTubeDialog(true)}
        title="Embed YouTube video"
        className="hidden md:inline-flex"
        tabIndex={tabIndexFor('youtube')}
        onFocus={() => setActiveItemKey('youtube')}
        toolbarKey="youtube"
      >
        <Youtube className="w-4 h-4" />
      </ToolbarButton>
    </>
  )

  return (
    <div className="flex min-h-[44px] w-full min-w-0 items-stretch gap-2 overflow-x-hidden bg-background py-2 md:overflow-x-visible">
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Editor formatting"
        onKeyDown={handleToolbarKeyDown}
        onFocusCapture={handleToolbarFocusCapture}
        className="flex min-w-0 flex-1 items-stretch gap-2"
      >
        <div className="min-w-0 flex-1 md:overflow-x-auto md:overflow-y-hidden md:overscroll-x-contain md:[scrollbar-width:thin]">
          <div className="flex min-h-[44px] flex-wrap items-center gap-0.5 md:inline-flex md:flex-nowrap">
            {formattingControls}
            {desktopAlignmentControls}
            {addMenu}
            {linkControl}
            {desktopMediaControls}
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-0 border-l border-border pl-2">
          <div className="md:hidden">{moreMenu}</div>
          {notesControl}
        </div>
      </div>

      {linkPopover}

      {showImageDialog && (
        <ImageUploadDialog
          isOpen={showImageDialog}
          onClose={() => setShowImageDialog(false)}
          onImageSelect={handleImageSelect}
          triggerRef={imageDialogTriggerRef}
        />
      )}

      {showYouTubeDialog && (
        <YouTubeEmbedDialog
          isOpen
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
      )}
    </div>
  )
}
