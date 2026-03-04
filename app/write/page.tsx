'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import TextAlign from '@tiptap/extension-text-align'
import { common, createLowlight } from 'lowlight'
import { ResizableImage } from '@/components/editor/extensions/ResizableImage'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { EditorActionBar } from '@/components/editor/EditorActionBar'
import { ImageUploadDialog } from '@/components/editor/ImageUploadDialog'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { toast } from 'sonner'

const lowlight = createLowlight(common)

export default function WritePage() {
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [tags, setTags] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [showCoverImageDialog, setShowCoverImageDialog] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [articleId, setArticleId] = useState<string | undefined>()
  const [editorContent, setEditorContent] = useState<JSONContent | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [publishStatus, setPublishStatus] = useState<{
    published: boolean
    publishedAt: Date | null
  }>({
    published: false,
    publishedAt: null,
  })

  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  // Convex mutations
  const createArticleMutation = useMutation(api.articles.createArticle)
  const publishArticleMutation = useMutation(api.articles.publishArticle)

  // Initialize editor with proper configuration
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        codeBlock: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'underline cursor-pointer',
        },
      }),
      ResizableImage.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg my-4',
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing your story...',
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'rounded-lg bg-gray-900 text-gray-100 p-4 my-4 overflow-x-auto',
        },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'prose prose-lg focus:outline-none min-h-[400px] py-6 break-words',
      },
    },
    onCreate: ({ editor }) => {
      // Set initial content state when editor is created
      const json = editor.getJSON()
      setEditorContent(json)
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      setEditorContent(json)
      setHasUnsavedChanges(true)
    },
  })

  // Auto-save hook - enable when we have a user and any content
  const { isSaving, lastSavedAt, error, saveNow } = useAutoSave({
    content: editorContent,
    articleId,
    title: title || 'Untitled',
    excerpt,
    coverImage: coverImage || undefined,
    enabled: isAuthenticated && (hasUnsavedChanges || !!title),
    onSaveSuccess: (response) => {
      if (!articleId && response.id) {
        setArticleId(response.id)
      }
      setHasUnsavedChanges(false)
    },
    onSaveError: (error) => {
      console.error('Auto-save error:', error)
    },
  })

  // Log article ID for development (F12 console)
  useEffect(() => {
    if (articleId && process.env.NODE_ENV === 'development') {
      console.log('[QuillTip] Article ID:', articleId)
    }
  }, [articleId])


  // Get draft ID from URL params
  const urlParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null
  const draftId = urlParams?.get('id')

  // Load draft using Convex query
  const draft = useQuery(
    api.articles.getArticleById,
    draftId ? { id: draftId as Id<'articles'> } : 'skip'
  )

  // Load draft data when it arrives
  useEffect(() => {
    if (draft && editor) {
      setArticleId(draft._id)
      setTitle(draft.title)
      setExcerpt(draft.excerpt || '')
      setCoverImage(draft.coverImage || '')
      setPublishStatus({
        published: draft.published,
        publishedAt: draft.publishedAt ? new Date(draft.publishedAt) : null,
      })
      if (draft.content) {
        queueMicrotask(() => {
          editor.commands.setContent(draft.content)
        })
        setEditorContent(draft.content)
      }
      // Reset unsaved changes flag after loading draft
      setHasUnsavedChanges(false)
    }
  }, [draft, editor])

  // Handle publish
  const handlePublish = useCallback(async () => {
    if (!editorContent) {
      toast.warning('Please add content before publishing')
      return
    }

    setIsPublishing(true)
    try {
      // Save one final time before publishing
      await saveNow()

      let resultId: string

      if (articleId) {
        // Publish existing draft
        resultId = await publishArticleMutation({
          id: articleId as Id<'articles'>,
        })
      } else {
        // Create and publish new article
        resultId = await createArticleMutation({
          title: title || 'Untitled',
          content: editorContent,
          excerpt: excerpt || undefined,
          coverImage: coverImage || undefined,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          published: true, // Publishing immediately
        })
      }

      // If it was a new article, update the articleId
      if (!articleId) {
        setArticleId(resultId)
      }

      // Update publish status
      setPublishStatus({
        published: true,
        publishedAt: new Date(),
      })

      toast.success('Article published successfully!')
    } catch (error) {
      console.error('Publish error:', error)
      toast.error(
        `Failed to publish: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    } finally {
      setIsPublishing(false)
    }
  }, [
    title,
    editorContent,
    excerpt,
    coverImage,
    tags,
    saveNow,
    articleId,
    publishArticleMutation,
    createArticleMutation,
  ])

  // Authentication checks
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    router.push('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <AppNavigation />
      <div className="flex flex-col pt-16">
        {/* Action bar - full width, Back | Undo | Redo | Save | Preview | Publish */}
        <EditorActionBar
          editor={editor}
          onBack={() => router.back()}
          onSave={() => {
            saveNow()
            setHasUnsavedChanges(false)
          }}
          onPreview={() => toast.info('Preview coming soon')}
          onPublish={handlePublish}
          isSaving={isSaving}
          error={error}
          isPublished={publishStatus.published}
          isPublishing={isPublishing}
          hasUnsavedChanges={hasUnsavedChanges}
          canPublish={!!editorContent}
          lastSavedAt={lastSavedAt ?? undefined}
        />
        <div className="flex-1 flex flex-col min-w-0 pb-8">
          <div className="relative w-full mb-6">
            <EditorToolbar
              editor={editor}
              onFocusCoverImage={() => {
                document.getElementById('field-cover-image')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                if (!coverImage) setShowCoverImageDialog(true)
              }}
              onFocusTitle={() => {
                const el = document.getElementById('article-title') as HTMLInputElement | null
                document.getElementById('field-article-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el?.focus()
              }}
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-[2px] bg-sky-400 pointer-events-none"
              aria-hidden
            />
          </div>
          <div className="w-full max-w-4xl mx-auto px-4 sm:px-6">
            {/* Cover Image */}
            <div id="field-cover-image" className="mb-4">
              {coverImage ? (
                <div className="relative w-full h-56 sm:h-72 rounded-xl overflow-hidden group">
                  <img
                    src={coverImage}
                    alt="Cover image"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setShowCoverImageDialog(true)}
                      className="px-4 py-2 bg-white text-gray-800 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors shadow"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCoverImage(''); setHasUnsavedChanges(true) }}
                      className="px-4 py-2 bg-white text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors shadow"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCoverImageDialog(true)}
                  className="w-full h-28 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center gap-2 text-gray-400 hover:border-sky-400 hover:text-sky-500 transition-colors group"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-medium">Add cover image</span>
                </button>
              )}
            </div>

            <div id="field-article-title" className="mb-2">
              <textarea
                id="article-title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setHasUnsavedChanges(true) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus() } }}
                placeholder="Untitled"
                rows={1}
                className="w-full resize-none overflow-hidden bg-transparent text-3xl font-semibold text-gray-900 placeholder:text-gray-300 focus:outline-none leading-snug py-2"
              />
            </div>

            {editor && (
              <EditorContent
                editor={editor}
                className="editor-content min-h-[400px]"
              />
            )}
          </div>
        </div>
      </div>

      <ImageUploadDialog
        isOpen={showCoverImageDialog}
        title="Add Cover Image"
        onImageSelect={(url) => {
          setCoverImage(url)
          setHasUnsavedChanges(true)
          setShowCoverImageDialog(false)
        }}
        onClose={() => setShowCoverImageDialog(false)}
      />
    </div>
  )
}
