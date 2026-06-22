'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'
import { lowlight } from '@/lib/lowlight'
import { useEffect } from 'react'
import { EditorToolbar } from './EditorToolbar'
import { ResizableImage } from './extensions/ResizableImage'
import { EditorKeymap } from './extensions/EditorKeymap'
import { EDITOR_PROSE_CLASS } from '@/lib/constants'

interface EditorWithToolbarProps {
  content?: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
  className?: string
  showToolbar?: boolean
}

export function EditorWithToolbar({
  content = '',
  onChange,
  placeholder = 'Start writing your story...',
  editable = true,
  className = '',
  showToolbar = true,
}: EditorWithToolbarProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        // StarterKit v3 ships codeBlock, link, and underline by default; we
        // register customised versions of each below, so disable them here
        // to avoid duplicate-extension warnings.
        codeBlock: false,
        link: false,
        underline: false,
      }),
      // Add Link separately with our configuration
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'underline cursor-pointer',
        },
      }),
      // Add Underline extension
      Underline,
      createYoutubeExtension(),
      ResizableImage.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg my-4',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class:
            'rounded-lg bg-muted text-foreground border border-border p-4 my-4 overflow-x-auto',
        },
      }),
      EditorKeymap,
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: `${EDITOR_PROSE_CLASS} min-h-[400px] px-8 py-4`,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onChange?.(html)
    },
  })

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editable, editor])

  return (
    <div
      className={`editor-wrapper bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border overflow-hidden ${className}`}
    >
      {showToolbar && editable && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} className="editor-content" />
    </div>
  )
}
