'use client'

import { ArticleAppearance } from '@/lib/editor/articleAppearance'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEditor, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import TextAlign from '@tiptap/extension-text-align'
import { lowlight } from '@/lib/lowlight'
import { WritingImage } from './WritingImage'
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'
import { EditorKeymap } from '@/components/editor/extensions/EditorKeymap'
import { useAuth } from '@/components/providers/AuthContext'
import { useCurrentUser } from '@/hooks/convex/useUsers'
import { useSuspendDialogModalForWallet } from '@/hooks/useSuspendDialogModalForWallet'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useConvex, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useArticleById } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { toast } from 'sonner'
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

const TITLE_PUBLISH_ERROR = 'Add a title before publishing'
const PUBLISH_WALLET_REQUIRED_FEEDBACK: FlowFeedback = {
  variant: 'default',
  title: 'Set up a receiving wallet before publishing',
  detail:
    'This makes the article tip-ready as soon as it goes live. Readers can still read for free.',
}

function editorTitleFromStored(storedTitle: string): string {
  return isPlaceholderArticleTitle(storedTitle) ? '' : storedTitle
}

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

export function useWritingWorkspace() {
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
  const excerptTextareaRef = useRef<HTMLTextAreaElement>(null)
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
  const [backupPrompt, setBackupPrompt] = useState<DraftBackup | null>(null)
  const [backupRecoveryStatus, setBackupRecoveryStatus] = useState<
    'pending' | 'resolved'
  >('pending')
  const [saveErrorDismissed, setSaveErrorDismissed] = useState(false)
  const [publishFeedback, setPublishFeedback] = useState<FlowFeedback | null>(
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

  const draftIdParam = searchParams.get('id') ?? searchParams.get('draft')

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

  const publishArticleMutation = useMutation(api.articles.publishArticle)

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
      WritingImage.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg my-4',
        },
      }),
      createYoutubeExtension(),
      Placeholder.configure({
        placeholder: 'Start with a thought…',
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
      ArticleAppearance,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'writer-body',
        'aria-label': 'Article body',
        role: 'textbox',
        'aria-multiline': 'true',
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

  const draft = useArticleById(
    draftIdParam ? (draftIdParam as Id<'articles'>) : undefined
  )

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
      isAuthenticated &&
      hasUnsavedChanges &&
      backupRecoveryStatus === 'resolved' &&
      !backupPrompt &&
      (!draftIdParam || (!!draft && draft.authorId === currentUser?._id)),
    onSaveSuccess: (response) => {
      hydratedDraftIdRef.current = response.id
      setArticleId(response.id)
      syncDraftIdInUrl(response.id)
      if (response.isCurrent) setHasUnsavedChanges(false)
      setSaveErrorDismissed(false)
      if (response.isCurrent && !recoveryDeferredRef.current) {
        clearDraftBackup()
      }
    },
    onSaveError: (error) => {
      console.error('Auto-save error:', error)
      setHasUnsavedChanges(true)
      setSaveErrorDismissed(false)
    },
  })

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

  // Publication status is server-owned even when local content is recovered.
  useEffect(() => {
    if (!draft || draft.authorId !== currentUser?._id) return
    setPublishStatus({
      published: draft.published,
      publishedAt: draft.publishedAt ? new Date(draft.publishedAt) : null,
    })
  }, [draft, currentUser?._id])

  useEffect(() => {
    if (backupRecoveryStatus !== 'resolved' || backupPrompt !== null) return
    if (!draft || !editor || draft.authorId !== currentUser?._id) return
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
        editor.commands.setContent(draft.content, { emitUpdate: false })
      })
      setEditorContent(draft.content)
    }
    setHasUnsavedChanges(false)
  }, [
    draft,
    editor,
    backupRecoveryStatus,
    backupPrompt,
    syncDraftIdInUrl,
    currentUser?._id,
  ])

  const applyDraftBackup = useCallback(
    (backup: DraftBackup) => {
      if (!editor) return
      if (backup.articleId) {
        hydratedDraftIdRef.current = backup.articleId
        setArticleId(backup.articleId)
        syncDraftIdInUrl(backup.articleId)
      }
      setTitle(editorTitleFromStored(backup.title))
      setExcerpt(backup.excerpt || '')
      setTags(backup.tags?.join(', ') ?? '')
      setCoverImage(backup.coverImage || '')
      setWriterNotes(backup.writerNotes ?? '')
      queueMicrotask(() => {
        editor.commands.setContent(backup.content, { emitUpdate: false })
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
      if (hasUnsavedRef.current) {
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
        if (
          backupRecoveryStatus === 'resolved' &&
          !backupPrompt &&
          (!draftIdParam || (draft && draft.authorId === currentUser?._id))
        )
          void saveNow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    saveNow,
    backupRecoveryStatus,
    backupPrompt,
    draftIdParam,
    draft,
    currentUser?._id,
  ])

  const focusTitleField = useCallback(() => {
    document
      .getElementById('field-article-title')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    requestAnimationFrame(() => {
      document.getElementById('article-title')?.focus()
    })
  }, [])

  const focusExcerptField = useCallback(() => {
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
    if (publishStatus.published) return
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
    publishStatus.published,
  ])

  const publishingRef = useRef(false)
  const handlePublish = useCallback(async () => {
    if (publishStatus.published) return
    if (publishingRef.current) return
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
    if (!receivingWalletAddress) {
      setPublishFeedback(PUBLISH_WALLET_REQUIRED_FEEDBACK)
      toast.warning(PUBLISH_WALLET_REQUIRED_FEEDBACK.title)
      return
    }

    setPublishFeedback(null)
    publishingRef.current = true
    setIsPublishing(true)
    try {
      const savedDraft = await saveNow()
      if (hasUnsavedChanges && !savedDraft) {
        throw new Error('Save your latest changes before publishing')
      }

      const targetArticleId = savedDraft?.id ?? articleId
      if (!targetArticleId) {
        throw new Error('Save your draft before publishing')
      }

      const published = await publishArticleMutation({
        id: targetArticleId as Id<'articles'>,
      })
      const resultId = published.id
      const publishedSlug = published.slug

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
      setPublishConfirmOpen(false)
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
      publishingRef.current = false
      setIsPublishing(false)
    }
  }, [
    title,
    editorContent,
    excerpt,
    saveNow,
    hasUnsavedChanges,
    articleId,
    publishArticleMutation,
    editor,
    syncDraftIdInUrl,
    blockPublishForPlaceholderTitle,
    focusTitleField,
    receivingWalletAddress,
    publishStatus.published,
  ])

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
          window.location.assign(pending.href)
        } else {
          router.back()
        }
      })
      return null
    })
  }, [router])

  const draftLoading =
    Boolean(draftIdParam) && (draft === undefined || currentUser === undefined)
  const draftUnavailable =
    Boolean(draftIdParam) &&
    !draftLoading &&
    (!draft || draft.authorId !== currentUser?._id)
  const publishUsername =
    savedArticleForLink?.authorUsername ??
    savedArticleForLink?.author?.username ??
    currentUser?.username
  const publishSlug = publishedSlugOverride ?? savedArticleForLink?.slug
  return {
    editor,
    title,
    setTitle,
    titleError,
    setTitleError,
    excerpt,
    setExcerpt,
    excerptTextareaRef,
    tags,
    setTags,
    coverImage,
    setCoverImage,
    showCoverImageDialog,
    setShowCoverImageDialog,
    showBodyImageDialog,
    setShowBodyImageDialog,
    showBodyYouTubeDialog,
    setShowBodyYouTubeDialog,
    bodyImageDragging,
    bodyImageUploading,
    bodyImageUploadProgress,
    bodyUploadAnnouncement,
    handleBodyEditorDragOver,
    handleBodyEditorDragLeave,
    handleBodyEditorDrop,
    uploadBodyImageFromFile,
    articleId,
    editorContent,
    writerNotes,
    setWriterNotes,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    isSaving,
    lastSavedAt,
    error,
    saveNow,
    navConfirm,
    setNavConfirm,
    confirmLeaveNavigation,
    hasUnsavedRef,
    recoveryDeferredRef,
    backupPrompt,
    setBackupPrompt,
    handleRestoreBackup,
    handleDiscardBackup,
    buildDraftBackup,
    saveErrorDismissed,
    setSaveErrorDismissed,
    publishFeedback,
    publishStatus,
    publishSuccessVisible,
    setPublishSuccessVisible,
    publishConfirmOpen,
    setPublishConfirmOpen,
    requestPublish,
    handlePublish,
    isPublishing,
    receivingWalletAddress,
    setReceivingWalletAddress,
    suspendDialogModalForWallet,
    publishUsername,
    publishSlug,
    pageOrigin,
    draftLoading,
    draftUnavailable,
    currentUser,
    initialWritingOpen: searchParams.get('desk') === 'writing',
  }
}
export type WritingWorkspace = ReturnType<typeof useWritingWorkspace>
