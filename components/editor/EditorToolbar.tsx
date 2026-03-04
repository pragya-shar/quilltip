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
  Sparkles,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Highlighter,
  Palette,
  FileText,
  Info,
  Tag,
} from 'lucide-react'
import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ImageUploadDialog } from './ImageUploadDialog'
import { toast } from 'sonner'

interface EditorToolbarProps {
  editor: Editor | null
  /** When Add icon is used to jump to a field */
  onFocusTitle?: () => void
  onFocusExcerpt?: () => void
  onFocusTags?: () => void
  onFocusCoverImage?: () => void
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
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`
        p-2 rounded hover:bg-gray-100 transition-colors shrink-0
        ${isActive ? 'bg-gray-100 text-blue-600' : 'text-gray-700'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-sky-300 mx-0.5 shrink-0" aria-hidden />
}

export function EditorToolbar({
  editor,
  onFocusTitle,
  onFocusExcerpt,
  onFocusTags,
  onFocusCoverImage,
}: EditorToolbarProps) {
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [showImageDialog, setShowImageDialog] = useState(false)

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
    const chain = editor.chain().focus() as { setTextAlign: (a: string) => { run: () => void } }
    if (typeof chain.setTextAlign === 'function') {
      chain.setTextAlign(align).run()
    }
  }

  return (
    <div className="bg-white w-full relative flex items-center justify-center min-h-[44px] px-6 py-2">
      <div className="flex items-center gap-0.5 flex-nowrap min-w-0 justify-center">
      {/* AI / Magic */}
      <ToolbarButton onClick={() => toast.info('AI tools coming soon')} title="AI tools" className="text-blue-600">
        <Sparkles className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Paragraph / style dropdown */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center gap-1.5 px-2.5 py-2 rounded hover:bg-gray-100 text-gray-700 text-sm shrink-0">
            <Type className="w-4 h-4 shrink-0" />
            <span>{getCurrentHeading()}</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
            {headingOptions.map((option) => (
              <DropdownMenu.Item
                key={option.level}
                onSelect={option.command}
                className="px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer outline-none"
              >
                {option.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Font size */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center gap-1 px-2 py-2 rounded hover:bg-gray-100 text-gray-700 text-sm min-w-[2.25rem] shrink-0">
            <span>18</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
            {[12, 14, 16, 18, 20, 24].map((size) => (
              <DropdownMenu.Item
                key={size}
                onSelect={() => toast.info('Font size applies to selection')}
                className="px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer outline-none"
              >
                {size}
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

      {/* Text color (placeholder) */}
      <ToolbarButton onClick={() => toast.info('Text color coming soon')} title="Text color">
        <Palette className="w-4 h-4" />
      </ToolbarButton>
      {/* Highlighter (placeholder) */}
      <ToolbarButton onClick={() => toast.info('Highlight coming soon')} title="Highlight">
        <Highlighter className="w-4 h-4" />
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
            className="p-2 rounded hover:bg-gray-100 text-gray-700 transition-colors cursor-pointer shrink-0"
            title="Add"
            aria-label="Add"
          >
            <Plus className="w-4 h-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[200px]"
            sideOffset={4}
            align="start"
          >
            <DropdownMenu.Item
              onSelect={() => onFocusCoverImage?.()}
              className="px-4 py-2.5 text-sm hover:bg-gray-100 cursor-pointer outline-none flex items-center gap-2"
            >
              <Image className="w-4 h-4 shrink-0" />
              Cover Image
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onFocusTitle?.()}
              className="px-4 py-2.5 text-sm hover:bg-gray-100 cursor-pointer outline-none flex items-center gap-2"
            >
              <Type className="w-4 h-4 shrink-0" />
              Article Title
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onFocusExcerpt?.()}
              className="px-4 py-2.5 text-sm hover:bg-gray-100 cursor-pointer outline-none flex items-center gap-2"
            >
              <FileText className="w-4 h-4 shrink-0" />
              Article Excerpt
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onFocusTags?.()}
              className="px-4 py-2.5 text-sm hover:bg-gray-100 cursor-pointer outline-none flex items-center gap-2"
            >
              <Tag className="w-4 h-4 shrink-0" />
              Tags
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Link */}
      <div className="relative shrink-0">
        {editor.isActive('link') ? (
          <ToolbarButton onClick={removeLink} isActive title="Remove link">
            <Link2 className="w-4 h-4" />
          </ToolbarButton>
        ) : (
          <ToolbarButton onClick={() => setShowLinkInput(!showLinkInput)} title="Insert link">
            <Link2 className="w-4 h-4" />
          </ToolbarButton>
        )}
        {showLinkInput && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-50 flex items-center gap-2">
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
              className="px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
              autoFocus
            />
            <button
              onClick={addLink}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Image */}
      <ToolbarButton onClick={() => setShowImageDialog(true)} title="Insert image">
        <Image className="w-4 h-4" />
      </ToolbarButton>

      {/* Info (placeholder) */}
      <ToolbarButton onClick={() => toast.info('Help')} title="Info">
        <Info className="w-4 h-4" />
      </ToolbarButton>
      </div>
      <div className="absolute right-6 flex items-center shrink-0">
        <button
          type="button"
          className="flex items-center gap-2 pl-3 pr-2 py-2 rounded hover:bg-gray-100 text-gray-700 text-sm font-medium"
          title="Notes"
          onClick={() => toast.info('Notes coming soon')}
        >
          <FileText className="w-4 h-4" />
          Notes
        </button>
      </div>

      <ImageUploadDialog
        isOpen={showImageDialog}
        onClose={() => setShowImageDialog(false)}
        onImageSelect={handleImageSelect}
      />
    </div>
  )
}
