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
} from 'lucide-react'
import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ImageUploadDialog } from './ImageUploadDialog'
import { YouTubeEmbedDialog } from './YouTubeEmbedDialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

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
}

function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  children,
  title,
  className = '',
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`
        p-2 rounded hover:bg-muted transition-colors shrink-0
        ${isActive ? 'bg-muted text-primary' : 'text-foreground'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-border mx-0.5 shrink-0" aria-hidden />
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
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [showImageDialog, setShowImageDialog] = useState(false)
  const [showYouTubeDialog, setShowYouTubeDialog] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

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

  return (
    <div className="bg-background w-full relative flex items-center justify-center min-h-[44px] px-6 py-2">
      <div className="flex items-center gap-0.5 flex-nowrap min-w-0 justify-center">
        {/* Paragraph / style dropdown */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              onMouseDown={(e) => e.preventDefault()}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded hover:bg-muted text-foreground text-sm shrink-0"
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
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline"
        >
          <Underline className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>

        {/* Quote */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Blockquote"
        >
          <Quote className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Code block, lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive('codeBlock')}
          title="Code block"
        >
          <Code className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Alignment */}
        <ToolbarButton
          onClick={() => setTextAlign('left')}
          isActive={editor.isActive({ textAlign: 'left' })}
          title="Align left"
        >
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setTextAlign('center')}
          isActive={editor.isActive({ textAlign: 'center' })}
          title="Align center"
        >
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setTextAlign('right')}
          isActive={editor.isActive({ textAlign: 'right' })}
          title="Align right"
        >
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setTextAlign('justify')}
          isActive={editor.isActive({ textAlign: 'justify' })}
          title="Justify"
        >
          <AlignJustify className="w-4 h-4" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Add - dropdown: Article Title, Cover Image URL, Excerpt, Tags */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className="p-2 rounded hover:bg-muted text-foreground transition-colors cursor-pointer shrink-0"
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
        <div className="shrink-0">
          {editor.isActive('link') ? (
            <ToolbarButton onClick={removeLink} isActive title="Remove link">
              <Link2 className="w-4 h-4" />
            </ToolbarButton>
          ) : (
            <Popover
              modal
              open={showLinkInput}
              onOpenChange={(open) => {
                setShowLinkInput(open)
                if (!open) setLinkUrl('')
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  title="Insert link"
                  aria-label="Insert link"
                  className="shrink-0 cursor-pointer rounded p-2 text-foreground transition-colors hover:bg-muted"
                >
                  <Link2 className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="start"
                sideOffset={4}
                className="flex w-auto items-center gap-2 border border-border bg-popover p-2 shadow-lg"
              >
                <input
                  type="url"
                  placeholder="Enter URL"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addLink()
                  }}
                  className="min-w-[200px] rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={addLink}
                  className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
                >
                  Add
                </button>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Image */}
        <ToolbarButton
          onClick={() => setShowImageDialog(true)}
          title="Insert image"
        >
          <Image className="w-4 h-4" />
        </ToolbarButton>

        {/* YouTube embed */}
        <ToolbarButton
          onClick={() => setShowYouTubeDialog(true)}
          title="Embed YouTube video"
        >
          <Youtube className="w-4 h-4" />
        </ToolbarButton>
      </div>
      <div className="absolute right-6 flex shrink-0 items-center">
        <Popover modal open={showNotes} onOpenChange={setShowNotes}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className={`flex items-center gap-2 rounded py-2 pl-3 pr-2 text-sm font-medium hover:bg-muted ${showNotes ? 'bg-muted text-primary' : 'text-foreground'}`}
              title="Notes"
            >
              <FileText className="h-4 w-4" />
              Notes
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="end"
            sideOffset={4}
            className="w-72 border border-border bg-popover p-0 shadow-lg"
          >
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              Personal Notes
            </div>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange?.(e.target.value)}
              placeholder="Jot down ideas, reminders, or notes..."
              className="w-full resize-none rounded-b-lg bg-popover p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              rows={6}
            />
          </PopoverContent>
        </Popover>
      </div>

      <ImageUploadDialog
        isOpen={showImageDialog}
        onClose={() => setShowImageDialog(false)}
        onImageSelect={handleImageSelect}
      />

      <YouTubeEmbedDialog
        isOpen={showYouTubeDialog}
        onClose={() => setShowYouTubeDialog(false)}
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
