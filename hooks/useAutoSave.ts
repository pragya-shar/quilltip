import { useEffect, useRef, useCallback, useState } from 'react'
import { JSONContent } from '@tiptap/react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

/** Convex may retry for a long time when offline; cap wait so the UI can show an error. */
const SAVE_DRAFT_TIMEOUT_MS = 30_000

interface DraftResponse {
  id: string
  title: string
  content: JSONContent
  excerpt?: string
  version: number
  createdAt: string
  updatedAt: string
}

interface UseAutoSaveOptions {
  content: JSONContent | null
  articleId?: string
  title?: string
  excerpt?: string
  tags?: string[]
  coverImage?: string
  writerNotes?: string
  enabled?: boolean
  onSaveSuccess?: (response: DraftResponse) => void
  onSaveError?: (error: Error) => void
}

interface AutoSaveState {
  isSaving: boolean
  lastSavedAt: Date | null
  error: Error | null
}

export function useAutoSave({
  content,
  articleId,
  title,
  excerpt,
  tags,
  coverImage,
  writerNotes,
  enabled = true,
  onSaveSuccess,
  onSaveError,
}: UseAutoSaveOptions) {
  const [state, setState] = useState<AutoSaveState>({
    isSaving: false,
    lastSavedAt: null,
    error: null,
  })

  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const previousContentRef = useRef<string | undefined>(undefined)
  const previousTitleRef = useRef<string | undefined>(undefined)
  const previousCoverImageRef = useRef<string | undefined>(undefined)
  const previousExcerptRef = useRef<string | undefined>(undefined)
  const previousTagsRef = useRef<string | undefined>(undefined)
  const previousNotesRef = useRef<string | undefined>(undefined)

  // Convex mutation for saving drafts
  const saveDraftMutation = useMutation(api.articles.saveDraft)

  const saveDraft = useCallback(async () => {
    // Allow save when we have content OR (title or coverImage) for metadata-only drafts
    const hasContent = !!content
    const hasMetadata = !!(title?.trim() || coverImage || writerNotes?.trim())
    if (!hasContent && !hasMetadata) return

    setState((prev) => {
      if (prev.isSaving) return prev
      return { ...prev, isSaving: true, error: null }
    })

    const contentToSave = content ?? EMPTY_DOC
    const mutationPromise = saveDraftMutation({
      id: articleId as Id<'articles'> | undefined,
      title: title || 'Untitled',
      content: contentToSave,
      excerpt,
      tags: tags?.length ? tags : undefined,
      coverImage: coverImage || undefined,
      writerNotes: writerNotes?.trim() ? writerNotes : undefined,
    })

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Save timed out. Check your connection.'))
      }, SAVE_DRAFT_TIMEOUT_MS)
    })

    try {
      const draftId = await Promise.race([mutationPromise, timeoutPromise])
      if (timeoutId !== undefined) clearTimeout(timeoutId)

      setState((prev) => ({
        ...prev,
        isSaving: false,
        lastSavedAt: new Date(),
        error: null,
      }))

      const response: DraftResponse = {
        id: draftId,
        title: title || 'Untitled',
        content: contentToSave,
        excerpt,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      onSaveSuccess?.(response)
    } catch (error) {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      void mutationPromise.catch(() => {})

      const err =
        error instanceof Error ? error : new Error('Failed to save draft')

      setState((prev) => ({
        ...prev,
        isSaving: false,
        error: err,
      }))

      onSaveError?.(err)
    }
  }, [
    content,
    articleId,
    title,
    excerpt,
    tags,
    coverImage,
    writerNotes,
    onSaveSuccess,
    onSaveError,
    saveDraftMutation,
  ])

  const debouncedSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      saveDraft()
    }, 10000) // 10 seconds
  }, [saveDraft])

  // Effect to handle content, title, coverImage, and excerpt changes
  useEffect(() => {
    const hasContent = !!content
    const hasMetadata = !!(title?.trim() || coverImage || writerNotes?.trim())
    if (!enabled || (!hasContent && !hasMetadata)) return

    const contentString = content ? JSON.stringify(content) : ''
    const titleVal = title ?? ''
    const coverImageVal = coverImage ?? ''
    const excerptVal = excerpt ?? ''
    const tagsVal = tags?.join(',') ?? ''
    const notesVal = writerNotes ?? ''

    const contentChanged = previousContentRef.current !== contentString
    const titleChanged = previousTitleRef.current !== titleVal
    const coverImageChanged = previousCoverImageRef.current !== coverImageVal
    const excerptChanged = previousExcerptRef.current !== excerptVal
    const tagsChanged = previousTagsRef.current !== tagsVal
    const notesChanged = previousNotesRef.current !== notesVal

    if (
      contentChanged ||
      titleChanged ||
      coverImageChanged ||
      excerptChanged ||
      tagsChanged ||
      notesChanged
    ) {
      previousContentRef.current = contentString
      previousTitleRef.current = titleVal
      previousCoverImageRef.current = coverImageVal
      previousExcerptRef.current = excerptVal
      previousTagsRef.current = tagsVal
      previousNotesRef.current = notesVal
      debouncedSave()
    }

    // Cleanup on unmount or when deps change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [
    content,
    title,
    coverImage,
    excerpt,
    tags,
    writerNotes,
    enabled,
    debouncedSave,
  ])

  // Save immediately function for manual triggers
  const saveNow = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    await saveDraft()
  }, [saveDraft])

  return {
    ...state,
    saveNow,
  }
}
