'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { ResizableImage } from '@/components/editor/extensions/ResizableImage'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useQuery, useMutation, useConvex } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { uploadFile, compressImage } from '@/lib/upload'
import { toast } from 'sonner'

const lowlight = createLowlight(common)

export default function WritePage() {
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [coverImageInput, setCoverImageInput] = useState('')
  const [isUploadingCover, setIsUploadingCover] = useState(false)
  const [coverUploadError, setCoverUploadError] = useState('')
  const [tags, setTags] = useState('')
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
  const convex = useConvex()

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
          class: 'text-blue-600 underline cursor-pointer hover:text-blue-800',
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
          class:
            'rounded-lg bg-gray-900 text-gray-100 p-4 my-4 overflow-x-auto',
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'prose prose-lg max-w-none focus:outline-none min-h-[400px] px-8 py-4',
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
      setPublishStatus({
        published: draft.published,
        publishedAt: draft.publishedAt ? new Date(draft.publishedAt) : null,
      })
      if (draft.content) {
        editor.commands.setContent(draft.content)
        setEditorContent(draft.content)
      }
      // Reset unsaved changes flag after loading draft
      setHasUnsavedChanges(false)
    }
  }, [draft, editor])

  // Handle cover image URL upload
  const handleCoverImageUpload = useCallback(
    async (url: string) => {
      if (!url.trim()) {
        setCoverImage('')
        return
      }

      // Check if it's already a Convex URL
      if (url.includes('convex.cloud') || url.includes('convex.site')) {
        setCoverImage(url)
        return
      }

      setIsUploadingCover(true)
      setCoverUploadError('')

      try {
        // Fetch the image from the URL
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error('Failed to fetch image from URL')
        }

        const blob = await response.blob()

        // Check if it's actually an image
        if (!blob.type.startsWith('image/')) {
          throw new Error('URL does not point to a valid image')
        }

        // Convert blob to File
        const file = new File([blob], 'cover-image', { type: blob.type })

        // Compress and upload to Convex storage
        const compressedFile = await compressImage(file, 1200, 0.8)
        const result = await uploadFile(
          compressedFile,
          convex,
          'cover_image',
          undefined // no specific article yet
        )

        if (result.success && result.url) {
          setCoverImage(result.url)
          setCoverImageInput(result.url)
          setCoverUploadError('')
        } else {
          throw new Error(result.error || 'Upload failed')
        }
      } catch (error) {
        console.error('Cover image upload error:', error)
        if (error instanceof Error) {
          if (error.message.includes('Failed to fetch')) {
            setCoverUploadError(
              'Unable to fetch image. It may be protected by CORS.'
            )
          } else {
            setCoverUploadError(error.message)
          }
        } else {
          setCoverUploadError('Failed to upload image')
        }
        // Keep the original URL in the input
        setCoverImage(url)
      } finally {
        setIsUploadingCover(false)
      }
    },
    [convex]
  )

  // Handle publish
  const handlePublish = useCallback(async () => {
    if (!title || !editorContent) {
      toast.warning('Please add a title and content before publishing')
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
          title,
          content: editorContent,
          excerpt: excerpt || undefined,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          coverImage: coverImage || undefined,
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
    tags,
    coverImage,
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
    <div className="min-h-screen bg-gray-50">
      <AppNavigation />
      <div className="max-w-5xl mx-auto pt-24 pb-8 px-4">
        {/* Header with auto-save status */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Write Your Story
            </h1>
            {articleId && (
              <div className="text-sm mt-1">
                <p className="text-gray-500">Article ID: {articleId}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-medium">Status:</span>
                  {publishStatus.published ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                      <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                      Published
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                      Draft
                    </span>
                  )}
                  {publishStatus.published && publishStatus.publishedAt && (
                    <span className="text-xs text-gray-500">
                      • Published{' '}
                      {publishStatus.publishedAt.toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* Auto-save status */}
            <div className="text-sm text-gray-500">
              {isSaving && (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>
                  Saving...
                </span>
              )}
              {!isSaving && lastSavedAt && (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-green-400 rounded-full"></span>
                  Saved {lastSavedAt.toLocaleTimeString()}
                </span>
              )}
              {error && (
                <span className="flex items-center gap-2 text-red-500">
                  <span className="inline-block w-2 h-2 bg-red-400 rounded-full"></span>
                  Save failed
                </span>
              )}
            </div>

            {/* Manual save button */}
            <button
              onClick={() => {
                saveNow()
                setHasUnsavedChanges(false)
              }}
              disabled={isSaving || !hasUnsavedChanges}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Save now (auto-saves every 30 seconds)"
            >
              {isSaving ? 'Saving...' : 'Save Now'}
            </button>

            {/* Publish button */}
            {publishStatus.published ? (
              <span className="inline-flex items-center gap-1 px-4 py-2 bg-green-100 text-green-800 text-sm font-medium rounded-lg">
                Published
              </span>
            ) : (
              <button
                onClick={handlePublish}
                disabled={isPublishing || !title || !editorContent}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Make this article public (permanent — stored on Arweave)"
              >
                {isPublishing ? 'Publishing...' : 'Publish'}
              </button>
            )}
          </div>
        </div>

        {/* Title Input */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Article Title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setHasUnsavedChanges(true)
            }}
            className="w-full text-3xl font-bold border-0 border-b-2 border-gray-200 focus:border-blue-500 outline-none pb-2 bg-transparent placeholder-gray-400"
          />
        </div>

        {/* Cover Image URL */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="url"
              placeholder="Cover Image URL (optional - will be uploaded to storage)"
              value={coverImageInput}
              onChange={(e) => {
                setCoverImageInput(e.target.value)
                setHasUnsavedChanges(true)
              }}
              onBlur={(e) => {
                if (e.target.value && e.target.value !== coverImage) {
                  handleCoverImageUpload(e.target.value)
                }
              }}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  coverImageInput &&
                  coverImageInput !== coverImage
                ) {
                  e.preventDefault()
                  handleCoverImageUpload(coverImageInput)
                }
              }}
              disabled={isUploadingCover}
              className="w-full px-4 py-2 pr-32 border border-gray-200 rounded-lg focus:border-blue-500 outline-none placeholder-gray-400 disabled:bg-gray-50"
            />
            {isUploadingCover && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                Uploading...
              </div>
            )}
          </div>

          {coverUploadError && (
            <p className="mt-1 text-sm text-red-600">{coverUploadError}</p>
          )}

          {coverImage && (
            <div className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverImage}
                alt="Cover preview"
                className="h-48 w-full object-cover rounded-lg"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              {coverImage.includes('convex') && (
                <p className="mt-1 text-xs text-green-600">
                  ✓ Image uploaded to storage
                </p>
              )}
            </div>
          )}
        </div>

        {/* Editor with Toolbar */}
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <EditorToolbar editor={editor} />
          <EditorContent editor={editor} className="editor-content" />
        </div>

        {/* Excerpt */}
        <div className="mb-6">
          <label
            htmlFor="article-excerpt"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Article Excerpt
          </label>
          <textarea
            id="article-excerpt"
            placeholder="Brief description of your article (optional)"
            value={excerpt}
            onChange={(e) => {
              setExcerpt(e.target.value)
              setHasUnsavedChanges(true)
            }}
            rows={3}
            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none resize-none placeholder-gray-400"
          />
        </div>

        {/* Tags */}
        <div className="mb-6">
          <label
            htmlFor="article-tags"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Tags
          </label>
          <input
            id="article-tags"
            type="text"
            placeholder="Add tags separated by commas (e.g., technology, programming, web)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none placeholder-gray-400"
          />
        </div>

        {/* Help text */}
        <div className="text-sm text-gray-500 bg-blue-50 p-4 rounded-lg">
          <p className="font-semibold mb-2">Auto-save is enabled</p>
          <ul className="space-y-1">
            <li>• Your work is automatically saved every 30 seconds</li>
            <li>• The green indicator shows when your work was last saved</li>
            <li>• Your draft will be saved even if you close the browser</li>
            <li>
              • Use the &quot;Publish&quot; button when you&apos;re ready to
              make your article public
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
