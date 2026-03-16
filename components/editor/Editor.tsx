'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Youtube from '@tiptap/extension-youtube'
import { common, createLowlight } from 'lowlight'
import { useEffect, useState } from 'react'
import { ResizableImage } from './extensions/ResizableImage'
import { uploadFile, compressImage } from '@/lib/upload'
import { useConvex } from 'convex/react'

const lowlight = createLowlight(common)

interface EditorProps {
  content?: string
  onChange?: (content: string) => void
  placeholder?: string
  editable?: boolean
  className?: string
}

export function Editor({
  content = '',
  onChange,
  placeholder = 'Start writing your story...',
  editable = true,
  className = '',
}: EditorProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  // Get Convex client for uploads
  const convex = useConvex()

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging to false if we're leaving the editor container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (!editor || !editable) return

    const files = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))

    if (imageFiles.length === 0) {
      return // No image files dropped
    }

    setIsUploading(true)
    setUploadProgress(0)

    try {
      // Upload the first image file
      const file = imageFiles[0]
      if (!file) return

      // Compress image before upload for better performance
      const compressedFile = await compressImage(file, 1200, 0.8)
      const result = await uploadFile(
        compressedFile,
        convex,
        'article_image',
        undefined, // no specific article
        (progress) => {
          setUploadProgress(progress.percentage)
        }
      )

      if (result.success && result.url) {
        // Insert the image at the current cursor position
        editor.chain().focus().setResizableImage({ src: result.url }).run()
      }
    } catch (error) {
      console.error('Error uploading dropped image:', error)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div
      className={`editor-wrapper bg-white rounded-lg shadow-sm border border-gray-200 relative ${className} ${
        isDragging ? 'border-blue-400 bg-blue-50' : ''
      } ${isUploading ? 'pointer-events-none' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-blue-50 bg-opacity-90 flex items-center justify-center z-10 rounded-lg border-2 border-dashed border-blue-400">
          <div className="text-center">
            <div className="text-blue-600 text-lg font-medium mb-2">
              Drop image here
            </div>
            <div className="text-blue-500 text-sm">Release to upload</div>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center z-10 rounded-lg">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <div className="text-gray-600 text-sm">
              Optimizing and uploading image...
            </div>
            <div className="mt-2 w-48 bg-gray-200 rounded-full h-2 mx-auto">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <div className="text-gray-500 text-xs mt-1">{uploadProgress}%</div>
          </div>
        </div>
      )}

      <EditorContent editor={editor} className="editor-content" />
    </div>
  )
}
