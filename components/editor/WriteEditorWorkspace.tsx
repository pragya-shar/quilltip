'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEditor, EditorContent, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import TextAlign from '@tiptap/extension-text-align'
import { lowlight } from '@/lib/lowlight'
import { ResizableImage } from '@/components/editor/extensions/ResizableImage'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { EditorActionBar } from '@/components/editor/EditorActionBar'
import { ImageUploadDialog } from '@/components/editor/ImageUploadDialog'
import { useAuth } from '@/components/providers/AuthContext'
import { EditorChromeSkeleton } from '@/components/editor/EditorChromeSkeleton'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useConvex, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useArticleById } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { toast } from 'sonner'
import Image from 'next/image'
import { EDITOR_PROSE_CLASS } from '@/lib/constants'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { ChevronDown } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { compressImage, uploadFile, validateImageUploadFile } from '@/lib/upload'

const PUBLISH_EXCERPT_PREVIEW_MAX = 280
const EXCERPT_MAX_CHARS = 500

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

type NavConfirmState = null | { kind: 'href'; href: string } | { kind: 'back' }

function getInternalNavHref(
  anchor: HTMLAnchorElement,
  e: MouseEvent
): string | null {
  if (e.button !== 0) return null
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null
  if (anchor.target === '_blank') return null
  if (anchor.getAttribute('download') !== null) return null
  const hrefAttr = anchor.getAttribute('href')
  if (!hrefAttr || hrefAttr.startsWith('#')) return null
  if (hrefAttr.startsWith('mailto:') || hrefAttr.startsWith('tel:')) return null
  let url: URL
  try {
    url = new URL(hrefAttr, window.location.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search
  ) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export function WriteEditorWorkspace() {
  const convex = useConvex()
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [tags, setTags] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [showCoverImageDialog, setShowCoverImageDialog] = useState(false)
  const [coverDropActive, setCoverDropActive] = useState(false)
  const [coverDropUploading, setCoverDropUploading] = useState(false)
  const [bodyImageDragging, setBodyImageDragging] = useState(false)
  const [bodyImageUploading, setBodyImageUploading] = useState(false)
  const [bodyImageUploadProgress, setBodyImageUploadProgress] = useState(0)
  const [isPublishing, setIsPublishing] = useState(false)
  const [articleId, setArticleId] = useState<string | undefined>()
  const [editorContent, setEditorContent] = useState<JSONContent | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [navConfirm, setNavConfirm] = useState<NavConfirmState>(null)
  const hasUnsavedRef = useRef(hasUnsavedChanges)
  const [excerptOpen, setExcerptOpen] = useState(false)
  const excerptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const tagsInputRef = useRef<HTMLInputElement>(null)
  const [publishStatus, setPublishStatus] = useState<{
    published: boolean
    publishedAt: Date | null
  }>({
    published: false,
    publishedAt: null,
  })
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated } = useAuth()

  useEffect(() => {
    hasUnsavedRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  const createArticleMutation = useMutation(api.articles.createArticle)
  const publishArticleMutation = useMutation(api.articles.publishArticle)
  const deleteArticleMutation = useMutation(api.articles.deleteArticle)

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
          class:
            'rounded-lg bg-muted text-foreground border border-border p-4 my-4 overflow-x-auto',
        },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: `${EDITOR_PROSE_CLASS} min-h-[400px] py-6 break-words`,
      },
    },
    onCreate: ({ editor }) => {
      const json = editor.getJSON()
      setEditorContent(json)
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      setEditorContent(json)
      setHasUnsavedChanges(true)
    },
  })

  const { isSaving, lastSavedAt, error, saveNow } = useAutoSave({
    content: editorContent,
    articleId,
    title: title || 'Untitled',
    excerpt,
    tags: tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
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

  const draftIdParam = searchParams.get('id')

  const draft = useArticleById(
    draftIdParam ? (draftIdParam as Id<'articles'>) : undefined
  )

  const savedArticleForLink = useArticleById(
    articleId ? (articleId as Id<'articles'>) : undefined
  )

  useEffect(() => {
    if (draft && editor) {
      setArticleId(draft._id)
      setTitle(draft.title)
      setExcerpt(draft.excerpt || '')
      setTags(draft.tags?.join(', ') ?? '')
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
      setHasUnsavedChanges(false)
    }
  }, [draft, editor])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const hasContent = !!editorContent
      const hasMetadata = !!(title?.trim() || coverImage)
      const autoSaveEnabled = isAuthenticated && (hasUnsavedChanges || !!title)
      if (autoSaveEnabled && (hasContent || hasMetadata)) {
        try {
          const tagsArr = tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
          localStorage.setItem(
            'quilltip_draft_backup',
            JSON.stringify({
              title: title || 'Untitled',
              content: editorContent ?? EMPTY_DOC,
              excerpt,
              tags: tagsArr.length ? tagsArr : undefined,
              coverImage: coverImage || undefined,
              articleId,
              savedAt: Date.now(),
            })
          )
        } catch {
          // localStorage unavailable or full
        }
      }
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [
    hasUnsavedChanges,
    isAuthenticated,
    editorContent,
    title,
    coverImage,
    excerpt,
    tags,
    articleId,
  ])

  useEffect(() => {
    const onDocumentClick = (e: MouseEvent) => {
      if (!hasUnsavedRef.current) return
      const target = e.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      const href = getInternalNavHref(anchor, e)
      if (!href) return
      e.preventDefault()
      e.stopPropagation()
      setNavConfirm({ kind: 'href', href })
    }
    document.addEventListener('click', onDocumentClick, true)
    return () => document.removeEventListener('click', onDocumentClick, true)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        saveNow()
        setHasUnsavedChanges(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveNow])

  const requestPublish = useCallback(() => {
    if (!editor || editor.isEmpty) {
      toast.warning('Please add content before publishing')
      return
    }
    setPublishConfirmOpen(true)
  }, [editor])

  const handlePublish = useCallback(async () => {
    if (!editor || editor.isEmpty) {
      setPublishConfirmOpen(false)
      toast.warning('Please add content before publishing')
      return
    }
    if (!editorContent) {
      setPublishConfirmOpen(false)
      toast.warning('Please add content before publishing')
      return
    }

    setIsPublishing(true)
    try {
      await saveNow()

      let resultId: string

      if (articleId) {
        const published = await publishArticleMutation({
          id: articleId as Id<'articles'>,
        })
        resultId = published.id
      } else {
        resultId = await createArticleMutation({
          title: title || 'Untitled',
          content: editorContent,
          excerpt: excerpt || undefined,
          coverImage: coverImage || undefined,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          published: true,
        })
      }

      if (!articleId) {
        setArticleId(resultId)
      }

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
    editor,
  ])

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this draft?')) return
    try {
      if (articleId) {
        await deleteArticleMutation({ id: articleId as Id<'articles'> })
        router.push('/')
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete draft'
      )
    }
  }, [articleId, deleteArticleMutation, router])

  const handleBack = useCallback(() => {
    if (hasUnsavedChanges) {
      setNavConfirm({ kind: 'back' })
    } else {
      router.back()
    }
  }, [hasUnsavedChanges, router])

  const handleCoverPlaceholderDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCoverDropActive(true)
  }, [])

  const handleCoverPlaceholderDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setCoverDropActive(false)
    }
  }, [])

  const handleCoverPlaceholderDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setCoverDropActive(false)

      const file = e.dataTransfer.files?.[0]
      if (!file) return

      const validation = validateImageUploadFile(file)
      if (!validation.ok) {
        toast.error(validation.error)
        return
      }

      setCoverDropUploading(true)
      try {
        const compressedFile = await compressImage(file, 1200, 0.8)
        const result = await uploadFile(
          compressedFile,
          convex,
          'article_image',
          undefined,
          undefined
        )
        if (result.success && result.url) {
          setCoverImage(result.url)
          setHasUnsavedChanges(true)
        } else {
          toast.error(result.error || 'Upload failed')
        }
      } catch (err) {
        console.error('Cover drop upload error:', err)
        toast.error('Upload failed. Please try again.')
      } finally {
        setCoverDropUploading(false)
      }
    },
    [convex]
  )

  const handleBodyEditorDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setBodyImageDragging(true)
  }, [])

  const handleBodyEditorDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setBodyImageDragging(false)
    }
  }, [])

  const handleBodyEditorDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setBodyImageDragging(false)

      if (!editor) return

      const files = Array.from(e.dataTransfer.files)
      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const file = imageFiles[0]
      if (!file) return

      const validation = validateImageUploadFile(file)
      if (!validation.ok) {
        toast.error(validation.error)
        return
      }

      setBodyImageUploading(true)
      setBodyImageUploadProgress(0)

      try {
        const compressedFile = await compressImage(file, 1200, 0.8)
        const result = await uploadFile(
          compressedFile,
          convex,
          'article_image',
          undefined,
          (progress) => {
            setBodyImageUploadProgress(progress.percentage)
          }
        )

        if (result.success && result.url) {
          editor.chain().focus().setResizableImage({ src: result.url }).run()
        } else {
          toast.error(result.error || 'Upload failed')
        }
      } catch (err) {
        console.error('Error uploading dropped image:', err)
        toast.error('Upload failed. Please try again.')
      } finally {
        setBodyImageUploading(false)
      }
    },
    [convex, editor]
  )

  const confirmLeaveNavigation = useCallback(() => {
    setNavConfirm((current) => {
      if (!current) return null
      const pending = current
      queueMicrotask(() => {
        if (pending.kind === 'href') {
          router.push(pending.href)
        } else {
          router.back()
        }
      })
      return null
    })
  }, [router])

  const draftLoading = Boolean(draftIdParam) && draft === undefined
  if (draftLoading) {
    return (
      <div className="flex flex-col pt-16">
        <EditorChromeSkeleton />
      </div>
    )
  }

  const tagsPreview =
    tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .join(', ') || 'No tags'
  const excerptTrimmed = excerpt.trim()
  const excerptPreview =
    excerptTrimmed.length === 0
      ? 'No excerpt'
      : excerptTrimmed.length <= PUBLISH_EXCERPT_PREVIEW_MAX
        ? excerptTrimmed
        : `${excerptTrimmed.slice(0, PUBLISH_EXCERPT_PREVIEW_MAX).trimEnd()}...`

  return (
    <div className="flex flex-col pt-16">
      <EditorActionBar
        editor={editor}
        onBack={handleBack}
        onSave={() => {
          saveNow()
          setHasUnsavedChanges(false)
        }}
        onPublish={requestPublish}
        isSaving={isSaving}
        error={error?.message ?? null}
        isPublished={publishStatus.published}
        isPublishing={isPublishing}
        canPublish={!!editor}
        lastSavedAt={lastSavedAt ?? undefined}
        onDelete={handleDelete}
        hasUnsavedChanges={hasUnsavedChanges}
      />
      <div className="flex min-w-0 flex-1 flex-col pb-8">
        <div className="sticky top-16 z-40 mb-6 w-full bg-background">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
            <EditorToolbar
              editor={editor}
              onFocusCoverImage={() => {
                document
                  .getElementById('field-cover-image')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                if (!coverImage) setShowCoverImageDialog(true)
              }}
              onFocusTitle={() => {
                const el = document.getElementById(
                  'article-title'
                ) as HTMLInputElement | null
                document
                  .getElementById('field-article-title')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el?.focus()
              }}
              onFocusExcerpt={() => {
                document
                  .getElementById('field-excerpt')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                setExcerptOpen(true)
                window.setTimeout(() => excerptTextareaRef.current?.focus(), 0)
              }}
              onFocusTags={() => {
                document
                  .getElementById('field-tags')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                window.setTimeout(() => tagsInputRef.current?.focus(), 0)
              }}
            />
          </div>
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
            aria-hidden
          />
        </div>
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
          <div id="field-cover-image" className="mb-4">
            {coverImage ? (
              <div className="group relative h-56 w-full overflow-hidden rounded-xl sm:h-72">
                <Image
                  src={coverImage}
                  alt="Article cover"
                  fill
                  sizes="(max-width: 768px) 100vw, 896px"
                  className="object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/0 opacity-0 transition-colors group-hover:bg-black/30 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setShowCoverImageDialog(true)}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow hover:bg-muted"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCoverImage('')
                      setHasUnsavedChanges(true)
                    }}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-destructive shadow hover:bg-destructive/10"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setShowCoverImageDialog(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setShowCoverImageDialog(true)
                  }
                }}
                onDragOver={handleCoverPlaceholderDragOver}
                onDragLeave={handleCoverPlaceholderDragLeave}
                onDrop={handleCoverPlaceholderDrop}
                className={cn(
                  'group flex h-28 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary',
                  coverDropActive &&
                    'border-primary bg-primary/15 text-primary',
                  coverDropUploading && 'pointer-events-none opacity-70'
                )}
              >
                <svg
                  className="h-5 w-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span className="text-sm font-medium">
                  {coverDropUploading
                    ? 'Uploading…'
                    : coverDropActive
                      ? 'Drop image to set cover'
                      : 'Add cover image'}
                </span>
              </div>
            )}
          </div>

          <div id="field-article-title" className="mb-2">
            <textarea
              id="article-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setHasUnsavedChanges(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  editor?.commands.focus()
                }
              }}
              placeholder="Untitled"
              rows={1}
              className="w-full resize-none overflow-hidden bg-transparent py-2 text-3xl font-semibold leading-snug text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            {savedArticleForLink?.authorUsername &&
              savedArticleForLink.slug && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  Public URL path (when published): /
                  {savedArticleForLink.authorUsername}/
                  {savedArticleForLink.slug}
                </p>
              )}
          </div>

          <div id="field-excerpt" className="mb-4">
            <Collapsible open={excerptOpen} onOpenChange={setExcerptOpen}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Excerpt
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {Math.min(excerpt.length, EXCERPT_MAX_CHARS)}/
                      {EXCERPT_MAX_CHARS}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Optional. Shown on article cards and in the publish preview.
                  </p>
                  {!excerptOpen && excerpt.trim().length > 0 && (
                    <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-foreground/80">
                      {excerpt.trim()}
                    </p>
                  )}
                </div>

                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      if (!excerptOpen) {
                        window.setTimeout(
                          () => excerptTextareaRef.current?.focus(),
                          0
                        )
                      }
                    }}
                    aria-label={excerptOpen ? 'Hide excerpt' : 'Add excerpt'}
                  >
                    <span>{excerptOpen ? 'Hide' : 'Add excerpt'}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${excerptOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </CollapsibleTrigger>
              </div>

              <CollapsibleContent className="mt-3">
                <Textarea
                  ref={excerptTextareaRef}
                  id="article-excerpt"
                  value={excerpt}
                  onChange={(e) => {
                    setExcerpt(e.target.value)
                    setHasUnsavedChanges(true)
                  }}
                  placeholder="Brief description of your article (optional)"
                  rows={3}
                  maxLength={EXCERPT_MAX_CHARS}
                  className="resize-none"
                />
              </CollapsibleContent>
            </Collapsible>
          </div>

          {editor && (
            <div
              className={cn(
                'relative min-h-[400px] rounded-[var(--card-radius)] border border-transparent transition-colors',
                bodyImageDragging && 'border-primary bg-primary/10',
                bodyImageUploading && 'pointer-events-none'
              )}
              onDragOver={handleBodyEditorDragOver}
              onDragLeave={handleBodyEditorDragLeave}
              onDrop={handleBodyEditorDrop}
            >
              <EditorContent
                editor={editor}
                className="editor-content min-h-[400px]"
              />

              {bodyImageDragging && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[var(--card-radius)] border-2 border-dashed border-primary bg-primary/15">
                  <div className="text-center">
                    <div className="mb-2 text-lg font-medium text-primary">
                      Drop image here
                    </div>
                    <div className="text-sm text-primary/80">
                      Release to add to article
                    </div>
                  </div>
                </div>
              )}

              {bodyImageUploading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[var(--card-radius)] bg-card/90">
                  <div className="text-center">
                    <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                    <div className="text-sm text-muted-foreground">
                      Optimizing and uploading image...
                    </div>
                    <div className="mx-auto mt-2 h-2 w-48 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${bodyImageUploadProgress}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {bodyImageUploadProgress}%
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div id="field-tags" className="mt-8 border-t border-border pt-4">
            <label
              htmlFor="article-tags"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Tags
            </label>
            <input
              id="article-tags"
              ref={tagsInputRef}
              type="text"
              value={tags}
              onChange={(e) => {
                setTags(e.target.value)
                setHasUnsavedChanges(true)
              }}
              placeholder="Add tags separated by commas (e.g. rust, programming)"
              className="w-full bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
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

      <AlertDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this article?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-sm text-muted-foreground">
                <p>
                  Publishing stores your content on Arweave (permanent storage).
                  You cannot undo this or remove that snapshot from Arweave.
                </p>
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-foreground">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Title
                    </div>
                    <p className="mt-0.5 font-medium">
                      {title.trim() || 'Untitled'}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Tags
                    </div>
                    <p className="mt-0.5">{tagsPreview}</p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Excerpt
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words">
                      {excerptPreview}
                    </p>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => {
                setPublishConfirmOpen(false)
                void handlePublish()
              }}
            >
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={navConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setNavConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your draft is not saved to the server yet. If you leave now,
              recent edits may be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmLeaveNavigation}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
