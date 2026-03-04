import { useEffect, useRef, useCallback, useState } from 'react'
import { JSONContent } from '@tiptap/react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'

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
  coverImage?: string
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
  coverImage,
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

  // Minimal TipTap doc for metadata-only saves (title/cover before body content)
  const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

  // Convex mutation for saving drafts
  const saveDraftMutation = useMutation(api.articles.saveDraft)

  const saveDraft = useCallback(async () => {
    // Allow save when we have content OR (title or coverImage) for metadata-only drafts
    const hasContent = !!content
    const hasMetadata = !!(title?.trim() || coverImage)
    if (!hasContent && !hasMetadata) return

    setState((prev) => {
      if (prev.isSaving) return prev
      return { ...prev, isSaving: true, error: null }
    })

    try {
      const contentToSave = content ?? EMPTY_DOC
      const draftId = await saveDraftMutation({
        id: articleId as Id<'articles'> | undefined,
        title: title || 'Untitled',
        content: contentToSave,
        excerpt,
        coverImage: coverImage || undefined,
      })

      setState((prev) => ({
        ...prev,
        isSaving: false,
        lastSavedAt: new Date(),
        error: null,
      }))

      // Create response compatible with existing interface
      const response: DraftResponse = {
        id: draftId,
        title: title || 'Untitled',
        content: contentToSave,
        excerpt,
        version: 1, // Convex handles versioning internally
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      onSaveSuccess?.(response)
    } catch (error) {
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
    coverImage,
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
    const hasMetadata = !!(title?.trim() || coverImage)
    if (!enabled || (!hasContent && !hasMetadata)) return

    const contentString = content ? JSON.stringify(content) : ''
    const titleVal = title ?? ''
    const coverImageVal = coverImage ?? ''
    const excerptVal = excerpt ?? ''

    const contentChanged = previousContentRef.current !== contentString
    const titleChanged = previousTitleRef.current !== titleVal
    const coverImageChanged = previousCoverImageRef.current !== coverImageVal
    const excerptChanged = previousExcerptRef.current !== excerptVal

    if (contentChanged || titleChanged || coverImageChanged || excerptChanged) {
      previousContentRef.current = contentString
      previousTitleRef.current = titleVal
      previousCoverImageRef.current = coverImageVal
      previousExcerptRef.current = excerptVal
      debouncedSave()
    }

    // Cleanup on unmount or when deps change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [content, title, coverImage, excerpt, enabled, debouncedSave])

  // Save immediately function for manual triggers
  const saveNow = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    await saveDraft()
  }, [saveDraft])

  // On mount, check for localStorage backup and restore if present
  useEffect(() => {
    try {
      const backup = localStorage.getItem('quilltip_draft_backup')
      if (backup) {
        // Backup exists but we only use it if there's no current content
        // The parent component can read this key if needed
        localStorage.removeItem('quilltip_draft_backup')
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, [])

  // Effect to save on window unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const hasContent = !!content;
      const hasMetadata = !!(title?.trim() || coverImage);
      if (enabled && (hasContent || hasMetadata)) {
        // Synchronously write to localStorage as a fallback since async mutations
        // won't complete before the page closes
        try {
          localStorage.setItem(
            'quilltip_draft_backup',
            JSON.stringify({
              title: title || 'Untitled',
              content: content ?? EMPTY_DOC,
              excerpt,
              coverImage,
              articleId,
              savedAt: Date.now(),
            })
          )
        } catch {
          // localStorage unavailable or full — ignore
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [enabled, content, title, excerpt, coverImage, articleId])

  return {
    ...state,
    saveNow,
  }
}
