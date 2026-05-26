'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'
import { lowlight } from '@/lib/lowlight'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ResizableImage } from './extensions/ResizableImage'
import { EditorKeymap } from './extensions/EditorKeymap'
import {
  uploadFile,
  compressImage,
  validateImageUploadFile,
  isAbortError,
} from '@/lib/upload'
import { EDITOR_PROSE_CLASS, UPLOAD_CONTROL_FOCUS_RING } from '@/lib/constants'
import { useConvex } from 'convex/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const BODY_FILE_INPUT_ID = 'editor-body-image-file-input'
const BODY_UPLOAD_ERROR_ID = 'editor-body-upload-error'
const BODY_UPLOAD_STATUS_ID = 'editor-body-upload-status'

type UploadAnnouncement = { type: 'status' | 'error'; text: string }

function shouldAnnounceProgress(last: number, next: number): boolean {
  return next === 0 || next >= 100 || next - last >= 25
}

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
  const [uploadAnnouncement, setUploadAnnouncement] =
    useState<UploadAnnouncement | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const bodyFileInputRef = useRef<HTMLInputElement>(null)
  const lastAnnouncedProgressRef = useRef(-1)

  const convex = useConvex()

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort()
      uploadAbortRef.current = null
    }
  }, [])

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

  const uploadImageFromFile = useCallback(
    async (file: File) => {
      if (!editor || !editable) return

      setUploadAnnouncement(null)
      lastAnnouncedProgressRef.current = -1

      const validation = validateImageUploadFile(file)
      if (!validation.ok) {
        setUploadAnnouncement({ type: 'error', text: validation.error })
        toast.error(validation.error)
        return
      }

      uploadAbortRef.current?.abort()
      const controller = new AbortController()
      uploadAbortRef.current = controller

      setIsUploading(true)
      setUploadProgress(0)
      setUploadAnnouncement({ type: 'status', text: 'Uploading image' })

      try {
        const compressedFile = await compressImage(
          file,
          1200,
          0.8,
          controller.signal
        )
        const result = await uploadFile(
          compressedFile,
          convex,
          'article_image',
          undefined,
          (progress) => {
            const pct = progress.percentage
            setUploadProgress(pct)
            if (shouldAnnounceProgress(lastAnnouncedProgressRef.current, pct)) {
              lastAnnouncedProgressRef.current = pct
              setUploadAnnouncement({
                type: 'status',
                text: `Uploading image, ${pct}% complete`,
              })
            }
          },
          controller.signal
        )

        if (result.success && result.url) {
          editor.chain().focus().setResizableImage({ src: result.url }).run()
          setUploadAnnouncement({
            type: 'status',
            text: 'Image added to article',
          })
        } else if (result.error) {
          setUploadAnnouncement({ type: 'error', text: result.error })
          toast.error(result.error)
        }
      } catch (error) {
        if (isAbortError(error)) {
          return
        }
        console.error('Error uploading dropped image:', error)
        const message =
          error instanceof Error
            ? error.message
            : 'Upload failed. Please try again.'
        setUploadAnnouncement({ type: 'error', text: message })
        toast.error(message)
      } finally {
        if (uploadAbortRef.current === controller) {
          uploadAbortRef.current = null
        }
        setIsUploading(false)
      }
    },
    [convex, editor, editable]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
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
      return
    }

    const file = imageFiles[0]
    if (!file) return

    await uploadImageFromFile(file)
  }

  const handleBodyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) {
      void uploadImageFromFile(file)
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className={cn(
          'editor-wrapper bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border relative',
          isDragging ? 'border-primary bg-primary/10' : '',
          isUploading ? 'pointer-events-none' : ''
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-describedby={
          [
            uploadAnnouncement?.type === 'error' ? BODY_UPLOAD_ERROR_ID : null,
            uploadAnnouncement?.type === 'status'
              ? BODY_UPLOAD_STATUS_ID
              : null,
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
      >
        {isDragging && (
          <div className="absolute inset-0 bg-primary/15 flex items-center justify-center z-10 rounded-lg border-2 border-dashed border-primary">
            <div className="text-center">
              <div className="text-primary text-lg font-medium mb-2">
                Drop image here to add it
              </div>
              <div className="text-primary/80 text-sm">
                or choose a file below
              </div>
            </div>
          </div>
        )}

        {isUploading && (
          <div
            className="absolute inset-0 bg-card bg-opacity-90 flex items-center justify-center z-10 rounded-lg"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <div className="text-muted-foreground text-sm">
                Optimizing and uploading image...
              </div>
              <div
                className="mt-2 w-48 bg-muted rounded-full h-2 mx-auto"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                aria-label="Image upload progress"
              >
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <div className="text-muted-foreground text-xs mt-1">
                {uploadProgress}%
              </div>
              {uploadAnnouncement?.type === 'status' ? (
                <p className="sr-only">{uploadAnnouncement.text}</p>
              ) : null}
            </div>
          </div>
        )}

        <EditorContent editor={editor} className="editor-content" />
      </div>
      <label
        className={cn(
          'inline-flex cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:text-primary/80 hover:underline',
          UPLOAD_CONTROL_FOCUS_RING
        )}
      >
        <input
          ref={bodyFileInputRef}
          id={BODY_FILE_INPUT_ID}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          onChange={handleBodyFileChange}
        />
        Choose image file
      </label>
      {uploadAnnouncement && !isUploading ? (
        <p
          id={
            uploadAnnouncement.type === 'error'
              ? BODY_UPLOAD_ERROR_ID
              : BODY_UPLOAD_STATUS_ID
          }
          role={uploadAnnouncement.type === 'error' ? 'alert' : 'status'}
          aria-live={
            uploadAnnouncement.type === 'error' ? 'assertive' : 'polite'
          }
          aria-atomic="true"
          className={cn(
            'text-xs',
            uploadAnnouncement.type === 'error' ? 'text-destructive' : 'sr-only'
          )}
        >
          {uploadAnnouncement.text}
        </p>
      ) : null}
    </div>
  )
}
