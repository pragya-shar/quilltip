'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Youtube from '@tiptap/extension-youtube'
import { common, createLowlight } from 'lowlight'
import { useEffect } from 'react'
import { EditorToolbar } from './EditorToolbar'
import { ResizableImage } from './extensions/ResizableImage'

const lowlight = createLowlight(common)

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
        codeBlock: false,
        // Disable Link from StarterKit since we're adding it separately
        link: false,
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
      // YouTube extension
      Youtube.configure({
        width: 640,
        height: 480,
        controls: true,
        nocookie: true,
        allowFullscreen: true,
        HTMLAttributes: {
          class: 'youtube-embed rounded-lg my-4',
        },
      }),
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
            'rounded-lg bg-gray-900 text-gray-100 p-4 my-4 overflow-x-auto',
        },
      }),
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class:
          'prose prose-lg max-w-none focus:outline-none min-h-[400px] px-8 py-4',
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
      className={`editor-wrapper bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden ${className}`}
    >
      {showToolbar && editable && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} className="editor-content" />
    </div>
  )
}
