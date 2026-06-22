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
import { EditorActionBar } from '@/components/editor/EditorActionBar'
import { EditorBubbleToolbar } from '@/components/editor/EditorBubbleToolbar'
import { EditorFloatingInsert } from '@/components/editor/EditorFloatingInsert'
import { ImageUploadDialog } from '@/components/editor/ImageUploadDialog'
import { YouTubeEmbedDialog } from '@/components/editor/YouTubeEmbedDialog'
import { useAuth } from '@/components/providers/AuthContext'
import { useCurrentUser } from '@/hooks/convex/useUsers'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import { useSuspendDialogModalForWallet } from '@/hooks/useSuspendDialogModalForWallet'
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
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import type { FlowFeedback } from '@/lib/feedback/flow-feedback'
import {
  PUBLISH_EMPTY_CONTENT_FEEDBACK,
  publishErrorFeedback,
} from '@/lib/editor/publish-feedback'
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
import { getListingReadyPublishError } from '@/convex/lib/articleListingReady'
import { getWriteUrlWithDraftId } from '@/lib/writeDraftUrl'
import {
  isPublishBlockedArticleTitle,
  isPlaceholderArticleTitle,
} from '@/convex/lib/articleTitle'
import { PublishSuccessPanel } from '@/components/editor/PublishSuccessPanel'

const ARTICLE_TITLE_ERROR_ID = 'article-title-error'
const TITLE_PUBLISH_ERROR = 'Add a title before publishing'
const EXCERPT_MAX_CHARS = 500

function editorTitleFromStored(storedTitle: string): string {
  return isPlaceholderArticleTitle(storedTitle) ? '' : storedTitle
}

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
  const [bodyImageDragging, setBodyImageDragging] = useState(false)
  const [bodyImageUploading, setBodyImageUploading] = useState(false)
  const [bodyImageUploadProgress, setBodyImageUploadProgress] = useState(0)
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const excerptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const tagsInputRef = useRef<HTMLInputElement>(null)
  const coverChangeButtonRef = useRef<HTMLButtonElement>(null)
  const [showBodyImageDialog, setShowBodyImageDialog] = useState(false)
  const [showBodyYouTubeDialog, setShowBodyYouTubeDialog] = useState(false)
  const bodyLastAnnouncedProgressRef = useRef(-1)
  const [publishStatus, setPublishStatus] = useState<{
    published: boolean
    publishedAt: Date | null
  }>({
    published: false,
    publishedAt: null,
  })
  const [publishSuccessVisible, setPublishSuccessVisible] = useState(false)
  const [publishedSlugOverride, setPublishedSlugOverride] = useState<
    string | null
  >(null)
  const [pageOrigin, setPageOrigin] = useState<string | null>(null)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [backupPrompt, setBackupPrompt] = useState<DraftBackup | null>(null)
  const [backupRecoveryStatus, setBackupRecoveryStatus] = useState<
    'pending' | 'resolved'
  >('pending')
  const [saveErrorDismissed, setSaveErrorDismissed] = useState(false)
  const [publishFeedback, setPublishFeedback] = useState<FlowFeedback | null>(
    null
  )
  const [deleteFeedback, setDeleteFeedback] = useState<FlowFeedback | null>(
    null
  )

  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated } = useAuth()
  const currentUser = useCurrentUser()
  const [receivingWalletAddress, setReceivingWalletAddress] = useState<
    string | null | undefined
  >(undefined)

  useEffect(() => {
    if (currentUser !== undefined) {
      setReceivingWalletAddress(currentUser?.stellarAddress ?? null)
    }
  }, [currentUser])

  const suspendDialogModalForWallet = useSuspendDialogModalForWallet()

  const bodyUploadAbortRef = useRef<AbortController | null>(null)
  const hydratedDraftIdRef = useRef<string | null>(null)

  const draftIdParam = searchParams.get('id')

  useEffect(() => {
    setPageOrigin(window.location.origin)
  }, [])

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
      bodyUploadAbortRef.current?.abort()
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
        placeholder: 'Share your thoughts...',
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
        class: `${EDITOR_PROSE_CLASS} min-h-[400px] py-0 break-words`,
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
      setPublishFeedback(null)
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
      setSaveErrorDismissed(false)
      if (!recoveryDeferredRef.current) {
        clearDraftBackup()
      }
    },
    onSaveError: (error) => {
      console.error('Auto-save error:', error)
      setHasUnsavedChanges(true)
      setSaveErrorDismissed(false)
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
    setTitle(editorTitleFromStored(draft.title))
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
      setTitle(editorTitleFromStored(backup.title))
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

  const focusExcerptField = useCallback(() => {
    setMoreMenuOpen(true)
    setExcerptOpen(true)
    window.setTimeout(() => excerptTextareaRef.current?.focus(), 0)
  }, [])

  const blockPublishForPlaceholderTitle = useCallback((): boolean => {
    if (isPublishBlockedArticleTitle(title)) {
      setTitleError(TITLE_PUBLISH_ERROR)
      focusTitleField()
      return true
    }
    setTitleError(null)
    return false
  }, [title, focusTitleField])

  const requestPublish = useCallback(() => {
    if (!editor || editor.isEmpty) {
      setPublishFeedback(PUBLISH_EMPTY_CONTENT_FEEDBACK)
      toast.warning('Please add content before publishing')
      return
    }
    if (blockPublishForPlaceholderTitle()) return
    const listingError = getListingReadyPublishError({ title, excerpt })
    if (listingError) {
      if (listingError.includes('excerpt')) {
        focusExcerptField()
      }
      toast.warning(listingError)
      return
    }
    setPublishFeedback(null)
    setPublishConfirmOpen(true)
  }, [
    editor,
    title,
    excerpt,
    blockPublishForPlaceholderTitle,
    focusExcerptField,
  ])

  const handlePublish = useCallback(async () => {
    if (!editor || editor.isEmpty) {
      setPublishConfirmOpen(false)
      setPublishFeedback(PUBLISH_EMPTY_CONTENT_FEEDBACK)
      toast.warning('Please add content before publishing')
      return
    }
    if (!editorContent) {
      setPublishConfirmOpen(false)
      setPublishFeedback(PUBLISH_EMPTY_CONTENT_FEEDBACK)
      toast.warning('Please add content before publishing')
      return
    }
    if (blockPublishForPlaceholderTitle()) {
      setPublishConfirmOpen(false)
      return
    }
    const listingError = getListingReadyPublishError({ title, excerpt })
    if (listingError) {
      setPublishConfirmOpen(false)
      toast.warning(listingError)
      return
    }

    setPublishFeedback(null)
    setIsPublishing(true)
    try {
      await saveNow()

      let resultId: string
      let publishedSlug: string | undefined

      if (articleId) {
        const published = await publishArticleMutation({
          id: articleId as Id<'articles'>,
        })
        resultId = published.id
        publishedSlug = published.slug
      } else {
        resultId = await createArticleMutation({
          title: title.trim(),
          content: editorContent,
          excerpt: excerpt.trim(),
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
      setPublishFeedback(null)

      if (publishedSlug) setPublishedSlugOverride(publishedSlug)
      setPublishSuccessVisible(true)
    } catch (error) {
      console.error('Publish error:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.toLowerCase().includes('title')) {
        setTitleError(TITLE_PUBLISH_ERROR)
        focusTitleField()
      } else {
        const feedback = publishErrorFeedback(error)
        setPublishFeedback(feedback)
        toast.error(
          feedback.detail
            ? `${feedback.title}: ${feedback.detail}`
            : feedback.title
        )
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
    setDeleteFeedback(null)
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
      const message =
        error instanceof Error ? error.message : 'Please try again.'
      setDeleteFeedback({
        variant: 'destructive',
        title: 'Failed to delete draft',
        detail: message,
      })
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

  const publishBlockReason =
    editor && !editor.isEmpty
      ? isPublishBlockedArticleTitle(title)
        ? TITLE_PUBLISH_ERROR
        : getListingReadyPublishError({ title, excerpt })
      : null

  const publishUsername =
    savedArticleForLink?.authorUsername ??
    savedArticleForLink?.author?.username ??
    null
  const publishSlug = publishedSlugOverride ?? savedArticleForLink?.slug ?? null

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
        canPublish={
          !!editor && !editor.isEmpty && !isPublishing && !publishBlockReason
        }
        publishBlockReason={publishBlockReason}
        onBlockReasonClick={
          publishBlockReason?.includes('excerpt')
            ? focusExcerptField
            : publishBlockReason
              ? focusTitleField
              : undefined
        }
        lastSavedAt={lastSavedAt ?? undefined}
        onDelete={handleRequestDelete}
        isDeleting={isDeleting}
        hasUnsavedChanges={hasUnsavedChanges}
        notes={writerNotes}
        onNotesChange={(value) => {
          setWriterNotes(value)
          setHasUnsavedChanges(true)
        }}
        onAddCoverImage={() => setShowCoverImageDialog(true)}
        hasCoverImage={!!coverImage}
        excerpt={excerpt}
        onExcerptChange={(value) => {
          setExcerpt(value)
          setHasUnsavedChanges(true)
        }}
        excerptOpen={excerptOpen}
        onExcerptOpenChange={setExcerptOpen}
        excerptTextareaRef={excerptTextareaRef}
        moreMenuOpen={moreMenuOpen}
        onMoreMenuOpenChange={setMoreMenuOpen}
        excerptMaxChars={EXCERPT_MAX_CHARS}
      />
      {publishSuccessVisible ? (
        <div className="mx-auto w-full max-w-4xl px-4 pt-4 sm:px-6">
          <PublishSuccessPanel
            title={title.trim() || 'Untitled'}
            excerpt={excerpt.trim().length ? excerpt.trim() : null}
            username={publishUsername}
            slug={publishSlug}
            origin={pageOrigin}
            onLeave={handleBack}
          />
        </div>
      ) : null}
      {publishFeedback && (
        <div className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-4xl items-start gap-2 px-4 py-3 sm:px-6">
            <Alert
              variant={
                publishFeedback.variant === 'destructive'
                  ? 'destructive'
                  : 'default'
              }
              className="flex-1"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{publishFeedback.title}</AlertTitle>
              {publishFeedback.detail ? (
                <AlertDescription>{publishFeedback.detail}</AlertDescription>
              ) : null}
            </Alert>
            <button
              type="button"
              onClick={() => setPublishFeedback(null)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss publish message"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {error && !saveErrorDismissed && (
        <div className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-4xl items-start gap-2 px-4 py-3 sm:px-6">
            <Alert variant="destructive" className="flex-1">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Couldn&apos;t save draft</AlertTitle>
              <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{error.message}</span>
                <button
                  type="button"
                  onClick={() => void saveNow()}
                  disabled={isSaving}
                  className="shrink-0 rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium hover:bg-destructive/10 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Retry save'}
                </button>
              </AlertDescription>
            </Alert>
            <button
              type="button"
              onClick={() => setSaveErrorDismissed(true)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss save error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col pb-8">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
          {coverImage ? (
            <div id="field-cover-image" className="mb-4">
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
            </div>
          ) : null}

          <div id="field-article-title" className="mb-0">
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
              placeholder="Title"
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

                <EditorBubbleToolbar editor={editor} />
                <EditorFloatingInsert
                  editor={editor}
                  onInsertImage={() => setShowBodyImageDialog(true)}
                  onInsertYouTube={() => setShowBodyYouTubeDialog(true)}
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

      {showBodyImageDialog && (
        <ImageUploadDialog
          isOpen={showBodyImageDialog}
          onImageSelect={(url) => {
            editor?.chain().focus().setResizableImage({ src: url }).run()
            setShowBodyImageDialog(false)
          }}
          onClose={() => setShowBodyImageDialog(false)}
        />
      )}

      {showBodyYouTubeDialog && (
        <YouTubeEmbedDialog
          isOpen
          onClose={() => setShowBodyYouTubeDialog(false)}
          onVideoEmbed={(url, width, height) => {
            if (!editor) return false
            return editor
              .chain()
              .focus()
              .setYoutubeVideo({ src: url, width, height })
              .run()
          }}
        />
      )}

      <Dialog
        open={publishConfirmOpen}
        onOpenChange={(open) => {
          if (!open && suspendDialogModalForWallet) return
          setPublishConfirmOpen(open)
        }}
        modal={!suspendDialogModalForWallet}
      >
        <DialogContent
          className="max-w-lg"
          onInteractOutside={(e) => {
            if (suspendDialogModalForWallet) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (suspendDialogModalForWallet) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Publishing details</DialogTitle>
            <DialogDescription className="text-left text-sm text-muted-foreground">
              Publishing stores your content on Arweave (permanent storage). You
              cannot undo this or remove that snapshot from Arweave.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Title
              </div>
              <p className="mt-0.5 font-medium">{title.trim() || 'Untitled'}</p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="publish-excerpt"
                className="text-xs font-medium text-muted-foreground"
              >
                Excerpt
                <span className="ml-1 text-muted-foreground/60">
                  (required · at least 10 characters)
                </span>
              </label>
              <Textarea
                ref={excerptTextareaRef}
                id="publish-excerpt"
                value={excerpt}
                onChange={(e) => {
                  setExcerpt(e.target.value)
                  setHasUnsavedChanges(true)
                }}
                placeholder="A short description shown on article cards..."
                rows={3}
                maxLength={EXCERPT_MAX_CHARS}
                className="resize-none text-sm"
              />
              <p className="text-right text-[11px] tabular-nums text-muted-foreground">
                {Math.min(excerpt.length, EXCERPT_MAX_CHARS)}/
                {EXCERPT_MAX_CHARS}
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="publish-tags"
                className="text-xs font-medium text-muted-foreground"
              >
                Tags
                <span className="ml-1 text-muted-foreground/60">
                  (optional)
                </span>
              </label>
              <input
                id="publish-tags"
                ref={tagsInputRef}
                type="text"
                value={tags}
                onChange={(e) => {
                  setTags(e.target.value)
                  setHasUnsavedChanges(true)
                }}
                placeholder="rust, programming, tutorial"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {receivingWalletAddress === null && (
              <div className="space-y-3">
                <ContextualWalletSetup
                  mode="receive"
                  onAddressSaved={(address) =>
                    setReceivingWalletAddress(address)
                  }
                />
                <p className="text-sm text-muted-foreground">
                  Readers cannot tip this article until a receiving wallet is
                  connected.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPublishConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPublishConfirmOpen(false)
                void handlePublish()
              }}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          {deleteFeedback && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{deleteFeedback.title}</AlertTitle>
              {deleteFeedback.detail ? (
                <AlertDescription>{deleteFeedback.detail}</AlertDescription>
              ) : null}
            </Alert>
          )}
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
