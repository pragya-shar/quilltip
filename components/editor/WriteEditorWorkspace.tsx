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
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'
import { EditorKeymap } from '@/components/editor/extensions/EditorKeymap'
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
import { EDITOR_PROSE_CLASS, UPLOAD_CONTROL_FOCUS_RING } from '@/lib/constants'
import { mutationWithTimeout } from '@/lib/convexMutationWithTimeout'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { ChevronDown, Loader2 } from 'lucide-react'
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
import {
  compressImage,
  uploadFile,
  validateImageUploadFile,
  isAbortError,
} from '@/lib/upload'
import {
  type DraftBackup,
  clearDraftBackup,
  formatBackupSavedAt,
  readDraftBackup,
  shouldOfferDraftRecovery,
  shouldPersistDraftBackup,
  writeDraftBackup,
} from '@/lib/draftBackup'
import { getWriteUrlWithDraftId } from '@/lib/writeDraftUrl'
import { isPlaceholderArticleTitle } from '@/convex/lib/articleTitle'

const PUBLISH_EXCERPT_PREVIEW_MAX = 280
const ARTICLE_TITLE_ERROR_ID = 'article-title-error'
const TITLE_PUBLISH_ERROR = 'Add a title before publishing'
const EXCERPT_MAX_CHARS = 500

const COVER_FILE_INPUT_ID = 'cover-image-file-input'
const BODY_FILE_INPUT_ID = 'body-image-file-input'
const COVER_UPLOAD_ERROR_ID = 'cover-upload-error'
const COVER_UPLOAD_STATUS_ID = 'cover-upload-status'
const BODY_UPLOAD_ERROR_ID = 'body-upload-error'
const BODY_UPLOAD_STATUS_ID = 'body-upload-status'

type UploadAnnouncement = { type: 'status' | 'error'; text: string }

function shouldAnnounceProgress(last: number, next: number): boolean {
  return next === 0 || next >= 100 || next - last >= 25
}

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
  const [titleError, setTitleError] = useState<string | null>(null)
  const [excerpt, setExcerpt] = useState('')
  const [tags, setTags] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [showCoverImageDialog, setShowCoverImageDialog] = useState(false)
  const [coverDropActive, setCoverDropActive] = useState(false)
  const [coverDropUploading, setCoverDropUploading] = useState(false)
  const [bodyImageDragging, setBodyImageDragging] = useState(false)
  const [bodyImageUploading, setBodyImageUploading] = useState(false)
  const [bodyImageUploadProgress, setBodyImageUploadProgress] = useState(0)
  const [coverUploadAnnouncement, setCoverUploadAnnouncement] =
    useState<UploadAnnouncement | null>(null)
  const [bodyUploadAnnouncement, setBodyUploadAnnouncement] =
    useState<UploadAnnouncement | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [articleId, setArticleId] = useState<string | undefined>()
  const [editorContent, setEditorContent] = useState<JSONContent | null>(null)
  const [writerNotes, setWriterNotes] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [navConfirm, setNavConfirm] = useState<NavConfirmState>(null)
  const hasUnsavedRef = useRef(hasUnsavedChanges)
  /** When true, user dismissed recovery (Not now / Esc); keep local backup until Restore/Discard. */
  const recoveryDeferredRef = useRef(false)
  const [excerptOpen, setExcerptOpen] = useState(false)
  const excerptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const tagsInputRef = useRef<HTMLInputElement>(null)
  const coverChangeButtonRef = useRef<HTMLButtonElement>(null)
  const coverFileInputRef = useRef<HTMLInputElement>(null)
  const bodyFileInputRef = useRef<HTMLInputElement>(null)
  const coverLastAnnouncedProgressRef = useRef(-1)
  const bodyLastAnnouncedProgressRef = useRef(-1)
  const [publishStatus, setPublishStatus] = useState<{
    published: boolean
    publishedAt: Date | null
  }>({
    published: false,
    publishedAt: null,
  })
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [backupPrompt, setBackupPrompt] = useState<DraftBackup | null>(null)
  const [backupRecoveryStatus, setBackupRecoveryStatus] = useState<
    'pending' | 'resolved'
  >('pending')

  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated } = useAuth()

  const coverUploadAbortRef = useRef<AbortController | null>(null)
  const bodyUploadAbortRef = useRef<AbortController | null>(null)
  const hydratedDraftIdRef = useRef<string | null>(null)

  const draftIdParam = searchParams.get('id')

  const syncDraftIdInUrl = useCallback(
    (id: string) => {
      const next = getWriteUrlWithDraftId(searchParams.toString(), id)
      if (next) {
        router.replace(next, { scroll: false })
      }
    },
    [router, searchParams]
  )

  useEffect(() => {
    if (draftIdParam) {
      setArticleId(draftIdParam)
    }
  }, [draftIdParam])

  useEffect(() => {
    return () => {
      coverUploadAbortRef.current?.abort()
      bodyUploadAbortRef.current?.abort()
      coverUploadAbortRef.current = null
      bodyUploadAbortRef.current = null
    }
  }, [])

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
      createYoutubeExtension(),
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
      EditorKeymap,
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
    writerNotes,
    enabled:
      isAuthenticated && (hasUnsavedChanges || !!title || !!writerNotes.trim()),
    onSaveSuccess: (response) => {
      setArticleId(response.id)
      syncDraftIdInUrl(response.id)
      setHasUnsavedChanges(false)
      if (!recoveryDeferredRef.current) {
        clearDraftBackup()
      }
    },
    onSaveError: (error) => {
      console.error('Auto-save error:', error)
      setHasUnsavedChanges(true)
    },
  })

  const draft = useArticleById(
    draftIdParam ? (draftIdParam as Id<'articles'>) : undefined
  )

  const savedArticleForLink = useArticleById(
    articleId ? (articleId as Id<'articles'>) : undefined
  )

  const buildDraftBackup = useCallback((): DraftBackup => {
    const tagsArr = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    return {
      title: title || 'Untitled',
      content: editorContent ?? EMPTY_DOC,
      excerpt: excerpt || undefined,
      tags: tagsArr.length ? tagsArr : undefined,
      coverImage: coverImage || undefined,
      writerNotes: writerNotes.trim() ? writerNotes : undefined,
      articleId,
      savedAt: Date.now(),
    }
  }, [editorContent, title, excerpt, tags, coverImage, writerNotes, articleId])

  const persistDraftBackup = useCallback(() => {
    const hasContent = !!editorContent
    const hasMetadata = !!(title?.trim() || coverImage || writerNotes.trim())
    if (
      !shouldPersistDraftBackup(
        isAuthenticated,
        hasUnsavedChanges,
        hasContent,
        hasMetadata
      )
    ) {
      return
    }
    writeDraftBackup(buildDraftBackup())
  }, [
    buildDraftBackup,
    editorContent,
    title,
    coverImage,
    writerNotes,
    hasUnsavedChanges,
    isAuthenticated,
  ])

  useEffect(() => {
    if (!editor || !isAuthenticated) return

    const draftLoadSettled = !draftIdParam || draft !== undefined
    if (!draftLoadSettled) return
    if (backupRecoveryStatus !== 'pending') return

    const backup = readDraftBackup()
    if (!backup) {
      setBackupRecoveryStatus('resolved')
      return
    }

    if (backup.articleId && !draftIdParam) {
      const url = getWriteUrlWithDraftId('', backup.articleId)
      if (url) {
        router.replace(url, { scroll: false })
        return
      }
    }

    const serverDraft =
      draft && draft !== null
        ? {
            title: draft.title,
            content: draft.content,
            excerpt: draft.excerpt,
            tags: draft.tags,
            coverImage: draft.coverImage,
            writerNotes: draft.writerNotes,
            updatedAt: draft.updatedAt,
          }
        : undefined

    if (
      shouldOfferDraftRecovery(backup, serverDraft, {
        urlArticleId: draftIdParam ?? undefined,
        stateArticleId: articleId,
      })
    ) {
      setBackupPrompt(backup)
    } else {
      clearDraftBackup()
    }
    setBackupRecoveryStatus('resolved')
  }, [
    editor,
    isAuthenticated,
    draft,
    draftIdParam,
    articleId,
    backupRecoveryStatus,
    router,
  ])

  useEffect(() => {
    hydratedDraftIdRef.current = null
  }, [draftIdParam])

  useEffect(() => {
    if (backupRecoveryStatus !== 'resolved' || backupPrompt !== null) return
    if (!draft || !editor) return
    if (hydratedDraftIdRef.current === draft._id) return

    hydratedDraftIdRef.current = draft._id
    setArticleId(draft._id)
    syncDraftIdInUrl(draft._id)
    setTitle(draft.title)
    setExcerpt(draft.excerpt || '')
    setTags(draft.tags?.join(', ') ?? '')
    setCoverImage(draft.coverImage || '')
    setWriterNotes(draft.writerNotes ?? '')
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
  }, [draft, editor, backupRecoveryStatus, backupPrompt, syncDraftIdInUrl])

  const applyDraftBackup = useCallback(
    (backup: DraftBackup) => {
      if (!editor) return
      if (backup.articleId) {
        setArticleId(backup.articleId)
        syncDraftIdInUrl(backup.articleId)
      }
      setTitle(backup.title)
      setExcerpt(backup.excerpt || '')
      setTags(backup.tags?.join(', ') ?? '')
      setCoverImage(backup.coverImage || '')
      setWriterNotes(backup.writerNotes ?? '')
      queueMicrotask(() => {
        editor.commands.setContent(backup.content)
      })
      setEditorContent(backup.content)
      setHasUnsavedChanges(true)
    },
    [editor, syncDraftIdInUrl]
  )

  const handleRestoreBackup = useCallback(() => {
    if (!backupPrompt) return
    recoveryDeferredRef.current = false
    applyDraftBackup(backupPrompt)
    clearDraftBackup()
    setBackupPrompt(null)
    setBackupRecoveryStatus('resolved')
  }, [backupPrompt, applyDraftBackup])

  const handleDiscardBackup = useCallback(() => {
    recoveryDeferredRef.current = false
    clearDraftBackup()
    setBackupPrompt(null)
    setBackupRecoveryStatus('resolved')
  }, [])

  useEffect(() => {
    const onPageHide = () => {
      persistDraftBackup()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [persistDraftBackup])

  useEffect(() => {
    if (!isAuthenticated || !hasUnsavedChanges) return
    const hasContent = !!editorContent
    const hasMetadata = !!(title?.trim() || coverImage)
    if (!hasContent && !hasMetadata) return

    const timeoutId = setTimeout(() => {
      persistDraftBackup()
    }, 2000)

    return () => clearTimeout(timeoutId)
  }, [
    persistDraftBackup,
    isAuthenticated,
    hasUnsavedChanges,
    editorContent,
    title,
    coverImage,
  ])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      persistDraftBackup()
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges, persistDraftBackup])

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
        void saveNow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveNow])

  const focusTitleField = useCallback(() => {
    document
      .getElementById('field-article-title')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    requestAnimationFrame(() => {
      document.getElementById('article-title')?.focus()
    })
  }, [])

  const blockPublishForPlaceholderTitle = useCallback((): boolean => {
    if (isPlaceholderArticleTitle(title)) {
      setTitleError(TITLE_PUBLISH_ERROR)
      focusTitleField()
      return true
    }
    setTitleError(null)
    return false
  }, [title, focusTitleField])

  const requestPublish = useCallback(() => {
    if (!editor || editor.isEmpty) {
      toast.warning('Please add content before publishing')
      return
    }
    if (blockPublishForPlaceholderTitle()) return
    setPublishConfirmOpen(true)
  }, [editor, blockPublishForPlaceholderTitle])

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
    if (blockPublishForPlaceholderTitle()) {
      setPublishConfirmOpen(false)
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
          title: title.trim(),
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
        syncDraftIdInUrl(resultId)
      }

      setPublishStatus({
        published: true,
        publishedAt: new Date(),
      })

      toast.success('Article published successfully!')
    } catch (error) {
      console.error('Publish error:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.toLowerCase().includes('title')) {
        setTitleError(TITLE_PUBLISH_ERROR)
        focusTitleField()
      } else {
        toast.error(`Failed to publish: ${message}`)
      }
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
    syncDraftIdInUrl,
    blockPublishForPlaceholderTitle,
    focusTitleField,
  ])

  const handleRequestDelete = useCallback(() => {
    if (!articleId || isDeleting) return
    setDeleteDialogOpen(true)
  }, [articleId, isDeleting])

  const handleConfirmDelete = useCallback(async () => {
    if (!articleId || isDeleting) return
    setIsDeleting(true)
    try {
      await mutationWithTimeout(
        deleteArticleMutation({ id: articleId as Id<'articles'> })
      )
      toast.success('Draft deleted')
      setDeleteDialogOpen(false)
      router.push('/')
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete draft. Please try again.')
      setIsDeleting(false)
    }
  }, [articleId, deleteArticleMutation, isDeleting, router])

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

  const uploadCoverFromFile = useCallback(
    async (file: File) => {
      setCoverUploadAnnouncement(null)
      coverLastAnnouncedProgressRef.current = -1

      const validation = validateImageUploadFile(file)
      if (!validation.ok) {
        setCoverUploadAnnouncement({ type: 'error', text: validation.error })
        toast.error(validation.error)
        return
      }

      coverUploadAbortRef.current?.abort()
      const controller = new AbortController()
      coverUploadAbortRef.current = controller

      setCoverDropUploading(true)
      setCoverUploadAnnouncement({
        type: 'status',
        text: 'Uploading cover image',
      })

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
            if (
              shouldAnnounceProgress(coverLastAnnouncedProgressRef.current, pct)
            ) {
              coverLastAnnouncedProgressRef.current = pct
              setCoverUploadAnnouncement({
                type: 'status',
                text: `Uploading cover image, ${pct}% complete`,
              })
            }
          },
          controller.signal
        )
        if (result.success && result.url) {
          setCoverImage(result.url)
          setHasUnsavedChanges(true)
          setCoverUploadAnnouncement({
            type: 'status',
            text: 'Cover image uploaded',
          })
        } else {
          const message = result.error || 'Upload failed'
          setCoverUploadAnnouncement({ type: 'error', text: message })
          toast.error(message)
        }
      } catch (err) {
        if (isAbortError(err)) {
          return
        }
        console.error('Cover upload error:', err)
        const message =
          err instanceof Error
            ? err.message
            : 'Upload failed. Please try again.'
        setCoverUploadAnnouncement({ type: 'error', text: message })
        toast.error(message)
      } finally {
        if (coverUploadAbortRef.current === controller) {
          coverUploadAbortRef.current = null
        }
        setCoverDropUploading(false)
      }
    },
    [convex]
  )

  const handleCoverPlaceholderDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setCoverDropActive(false)

      const file = e.dataTransfer.files?.[0]
      if (!file) return

      await uploadCoverFromFile(file)
    },
    [uploadCoverFromFile]
  )

  const handleCoverFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (file) {
        void uploadCoverFromFile(file)
      }
    },
    [uploadCoverFromFile]
  )

  const openCoverFilePicker = useCallback(() => {
    coverFileInputRef.current?.click()
  }, [])

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

  const uploadBodyImageFromFile = useCallback(
    async (file: File) => {
      if (!editor) return

      setBodyUploadAnnouncement(null)
      bodyLastAnnouncedProgressRef.current = -1

      const validation = validateImageUploadFile(file)
      if (!validation.ok) {
        setBodyUploadAnnouncement({ type: 'error', text: validation.error })
        toast.error(validation.error)
        return
      }

      bodyUploadAbortRef.current?.abort()
      const controller = new AbortController()
      bodyUploadAbortRef.current = controller

      setBodyImageUploading(true)
      setBodyImageUploadProgress(0)
      setBodyUploadAnnouncement({
        type: 'status',
        text: 'Uploading image',
      })

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
            setBodyImageUploadProgress(pct)
            if (
              shouldAnnounceProgress(bodyLastAnnouncedProgressRef.current, pct)
            ) {
              bodyLastAnnouncedProgressRef.current = pct
              setBodyUploadAnnouncement({
                type: 'status',
                text: `Uploading image, ${pct}% complete`,
              })
            }
          },
          controller.signal
        )

        if (result.success && result.url) {
          editor.chain().focus().setResizableImage({ src: result.url }).run()
          setBodyUploadAnnouncement({
            type: 'status',
            text: 'Image added to article',
          })
        } else {
          const message = result.error || 'Upload failed'
          setBodyUploadAnnouncement({ type: 'error', text: message })
          toast.error(message)
        }
      } catch (err) {
        if (isAbortError(err)) {
          return
        }
        console.error('Error uploading image:', err)
        const message =
          err instanceof Error
            ? err.message
            : 'Upload failed. Please try again.'
        setBodyUploadAnnouncement({ type: 'error', text: message })
        toast.error(message)
      } finally {
        if (bodyUploadAbortRef.current === controller) {
          bodyUploadAbortRef.current = null
        }
        setBodyImageUploading(false)
      }
    },
    [convex, editor]
  )

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

      await uploadBodyImageFromFile(file)
    },
    [editor, uploadBodyImageFromFile]
  )

  const handleBodyFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (file) {
        void uploadBodyImageFromFile(file)
      }
    },
    [uploadBodyImageFromFile]
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
          void saveNow()
        }}
        onPublish={requestPublish}
        isSaving={isSaving}
        error={error?.message ?? null}
        isPublished={publishStatus.published}
        isPublishing={isPublishing}
        canPublish={!!editor}
        lastSavedAt={lastSavedAt ?? undefined}
        onDelete={handleRequestDelete}
        isDeleting={isDeleting}
        hasUnsavedChanges={hasUnsavedChanges}
      />
      <div className="flex min-w-0 flex-1 flex-col pb-8">
        <div className="sticky top-16 z-40 mb-6 w-full bg-background">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
            <EditorToolbar
              editor={editor}
              notes={writerNotes}
              onNotesChange={(value) => {
                setWriterNotes(value)
                setHasUnsavedChanges(true)
              }}
              onFocusCoverImage={() => {
                document
                  .getElementById('field-cover-image')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                if (coverImage) {
                  window.setTimeout(
                    () => coverChangeButtonRef.current?.focus(),
                    0
                  )
                } else {
                  setShowCoverImageDialog(true)
                }
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
              <div
                className="group relative h-56 w-full overflow-hidden rounded-xl sm:h-72"
                role="group"
                aria-label="Cover image"
              >
                <Image
                  src={coverImage}
                  alt="Article cover"
                  fill
                  sizes="(max-width: 768px) 100vw, 896px"
                  className="object-cover"
                />
                <div
                  className={cn(
                    'absolute inset-0 flex items-center justify-center gap-3 bg-black/30 opacity-100 transition-colors',
                    '[@media(hover:hover)_and_(pointer:fine)]:bg-black/0 [@media(hover:hover)_and_(pointer:fine)]:opacity-0',
                    'group-hover:bg-black/30 group-hover:opacity-100',
                    'group-focus-within:bg-black/30 group-focus-within:opacity-100'
                  )}
                >
                  <button
                    ref={coverChangeButtonRef}
                    type="button"
                    onClick={() => setShowCoverImageDialog(true)}
                    aria-label="Change cover image"
                    className={cn(
                      'rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow hover:bg-muted',
                      UPLOAD_CONTROL_FOCUS_RING
                    )}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCoverImage('')
                      setHasUnsavedChanges(true)
                    }}
                    aria-label="Remove cover image"
                    className={cn(
                      'rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-destructive shadow hover:bg-destructive/10',
                      UPLOAD_CONTROL_FOCUS_RING
                    )}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Add cover image. Drag an image here, or choose a file."
                  aria-describedby={
                    [
                      coverUploadAnnouncement?.type === 'error'
                        ? COVER_UPLOAD_ERROR_ID
                        : null,
                      coverUploadAnnouncement?.type === 'status'
                        ? COVER_UPLOAD_STATUS_ID
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onClick={openCoverFilePicker}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openCoverFilePicker()
                    }
                  }}
                  onDragOver={handleCoverPlaceholderDragOver}
                  onDragLeave={handleCoverPlaceholderDragLeave}
                  onDrop={handleCoverPlaceholderDrop}
                  className={cn(
                    'group flex h-28 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary',
                    UPLOAD_CONTROL_FOCUS_RING,
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
                        : 'Drag an image here, or choose a file'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    className={cn(
                      'inline-flex cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:text-primary/80 hover:underline',
                      UPLOAD_CONTROL_FOCUS_RING
                    )}
                  >
                    <input
                      ref={coverFileInputRef}
                      id={COVER_FILE_INPUT_ID}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="sr-only"
                      onChange={handleCoverFileChange}
                    />
                    Choose file
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCoverImageDialog(true)}
                    className={cn(
                      'text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
                      UPLOAD_CONTROL_FOCUS_RING
                    )}
                  >
                    Paste image URL
                  </button>
                </div>
                {coverUploadAnnouncement ? (
                  <p
                    id={
                      coverUploadAnnouncement.type === 'error'
                        ? COVER_UPLOAD_ERROR_ID
                        : COVER_UPLOAD_STATUS_ID
                    }
                    role={
                      coverUploadAnnouncement.type === 'error'
                        ? 'alert'
                        : 'status'
                    }
                    aria-live={
                      coverUploadAnnouncement.type === 'error'
                        ? 'assertive'
                        : 'polite'
                    }
                    aria-atomic="true"
                    className={cn(
                      'text-xs',
                      coverUploadAnnouncement.type === 'error'
                        ? 'text-destructive'
                        : 'sr-only'
                    )}
                  >
                    {coverUploadAnnouncement.text}
                  </p>
                ) : null}
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
                if (titleError) setTitleError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  editor?.commands.focus()
                }
              }}
              placeholder="Untitled"
              rows={1}
              aria-invalid={!!titleError}
              aria-describedby={titleError ? ARTICLE_TITLE_ERROR_ID : undefined}
              className={cn(
                'w-full resize-none overflow-hidden bg-transparent py-2 text-3xl font-semibold leading-snug text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                titleError
                  ? 'rounded-md border border-destructive px-2 focus-visible:ring-destructive'
                  : 'border border-transparent'
              )}
            />
            {titleError ? (
              <p
                id={ARTICLE_TITLE_ERROR_ID}
                role="alert"
                className="mt-1 text-sm text-destructive"
              >
                {titleError}
              </p>
            ) : null}
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
            <div className="space-y-2">
              <div
                className={cn(
                  'relative min-h-[400px] rounded-[var(--card-radius)] border border-transparent transition-colors',
                  bodyImageDragging && 'border-primary bg-primary/10',
                  bodyImageUploading && 'pointer-events-none'
                )}
                onDragOver={handleBodyEditorDragOver}
                onDragLeave={handleBodyEditorDragLeave}
                onDrop={handleBodyEditorDrop}
                aria-describedby={
                  [
                    bodyUploadAnnouncement?.type === 'error'
                      ? BODY_UPLOAD_ERROR_ID
                      : null,
                    bodyUploadAnnouncement?.type === 'status'
                      ? BODY_UPLOAD_STATUS_ID
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              >
                <EditorContent
                  editor={editor}
                  className="editor-content min-h-[400px]"
                />

                {bodyImageDragging && (
                  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[var(--card-radius)] border-2 border-dashed border-primary bg-primary/15">
                    <div className="text-center">
                      <div className="mb-2 text-lg font-medium text-primary">
                        Drop image here to add it
                      </div>
                      <div className="text-sm text-primary/80">
                        or choose a file below
                      </div>
                    </div>
                  </div>
                )}

                {bodyImageUploading && (
                  <div
                    className="absolute inset-0 z-20 flex items-center justify-center rounded-[var(--card-radius)] bg-card/90"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <div className="text-center">
                      <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                      <div className="text-sm text-muted-foreground">
                        Optimizing and uploading image...
                      </div>
                      <div
                        className="mx-auto mt-2 h-2 w-48 rounded-full bg-muted"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={bodyImageUploadProgress}
                        aria-label="Image upload progress"
                      >
                        <div
                          className="h-2 rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${bodyImageUploadProgress}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {bodyImageUploadProgress}%
                      </div>
                      {bodyUploadAnnouncement?.type === 'status' ? (
                        <p className="sr-only">{bodyUploadAnnouncement.text}</p>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
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
                <p className="text-xs text-muted-foreground">
                  You can also insert an image from the toolbar.
                </p>
              </div>
              {bodyUploadAnnouncement &&
              !bodyImageUploading &&
              bodyUploadAnnouncement.type === 'error' ? (
                <p
                  id={BODY_UPLOAD_ERROR_ID}
                  role="alert"
                  aria-live="assertive"
                  aria-atomic="true"
                  className="text-xs text-destructive"
                >
                  {bodyUploadAnnouncement.text}
                </p>
              ) : bodyUploadAnnouncement &&
                !bodyImageUploading &&
                bodyUploadAnnouncement.type === 'status' ? (
                <p
                  id={BODY_UPLOAD_STATUS_ID}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="sr-only"
                >
                  {bodyUploadAnnouncement.text}
                </p>
              ) : null}
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

      {showCoverImageDialog && (
        <ImageUploadDialog
          isOpen={showCoverImageDialog}
          title="Add Cover Image"
          triggerRef={coverImage ? coverChangeButtonRef : undefined}
          onImageSelect={(url) => {
            setCoverImage(url)
            setHasUnsavedChanges(true)
            setShowCoverImageDialog(false)
          }}
          onClose={() => setShowCoverImageDialog(false)}
        />
      )}

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
        open={backupPrompt !== null}
        onOpenChange={(open) => {
          if (!open && backupPrompt !== null) {
            if (readDraftBackup()) {
              recoveryDeferredRef.current = true
            }
            setBackupPrompt(null)
            setBackupRecoveryStatus('resolved')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recover unsaved draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {backupPrompt
                ? `${formatBackupSavedAt(backupPrompt.savedAt)}. Restore this version or discard the local backup.`
                : 'A local backup of your draft was found.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Not now</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDiscardBackup}
            >
              Discard backup
            </AlertDialogAction>
            <AlertDialogAction type="button" onClick={handleRestoreBackup}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (isDeleting) return
          if (!open) setDeleteDialogOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The draft will be permanently
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmDelete()
              }}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
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
              recent edits and notes may be lost.
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
