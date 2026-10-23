import { useEffect, useRef, useCallback, useState } from 'react'
import { JSONContent } from '@tiptap/react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { AUTO_SAVE_DEBOUNCE_MS } from '@/lib/autosave'
import { CONVEX_MUTATION_TIMEOUT_MS } from '@/lib/convexMutationWithTimeout'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

interface DraftResponse {
  id: string
  isCurrent: boolean
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

export function useAutoSave(options: UseAutoSaveOptions) {
  const { enabled = true, articleId } = options
  const [state, setState] = useState<AutoSaveState>({
    isSaving: false,
    lastSavedAt: null,
    error: null,
  })
  const latest = useRef(options)
  latest.current = options
  const savedId = useRef(articleId)
  if (articleId) savedId.current = articleId
  const inFlight = useRef<Promise<DraftResponse | undefined> | null>(null)
  // A timeout does not cancel Convex. Retain the pending write so Retry cannot
  // create a second draft or overwrite a later edit out of order.
  const pending = useRef<{
    promise: Promise<string>
    value: UseAutoSaveOptions
  } | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const saveDraftMutation = useMutation(api.articles.saveDraft)
  const snapshot = (value: UseAutoSaveOptions) =>
    JSON.stringify({
      content: value.content,
      title: value.title,
      excerpt: value.excerpt,
      tags: value.tags,
      coverImage: value.coverImage,
      writerNotes: value.writerNotes,
    })
  const signature = snapshot(options)
  const saveNow = useCallback((): Promise<DraftResponse | undefined> => {
    clearTimeout(timeoutRef.current)
    if (inFlight.current) return inFlight.current
    const run = async (): Promise<DraftResponse | undefined> => {
      let response: DraftResponse | undefined
      do {
        const value = pending.current?.value ?? latest.current
        if (
          !value.content &&
          !(
            value.title?.trim() ||
            value.coverImage ||
            value.writerNotes?.trim()
          )
        )
          return undefined
        const started = snapshot(value)
        setState((prev) => ({ ...prev, isSaving: true, error: null }))
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          if (!pending.current) {
            const mutation = saveDraftMutation({
              id: savedId.current as Id<'articles'> | undefined,
              title: value.title || 'Untitled',
              content: value.content ?? EMPTY_DOC,
              excerpt: value.excerpt,
              tags: value.tags ?? [],
              coverImage: value.coverImage ?? '',
              writerNotes: value.writerNotes ?? '',
            })
            pending.current = { promise: mutation, value }
            void mutation.catch(() => {
              if (pending.current?.promise === mutation) pending.current = null
            })
          }
          const active = pending.current
          const id = await Promise.race([
            active.promise,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error('Save timed out. Check your connection.')),
                CONVEX_MUTATION_TIMEOUT_MS
              )
            }),
          ])
          pending.current = null
          savedId.current = id
          const isCurrent = started === snapshot(latest.current)
          response = {
            id,
            isCurrent,
            title: value.title || 'Untitled',
            content: value.content ?? EMPTY_DOC,
            excerpt: value.excerpt,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          setState({
            isSaving: !isCurrent,
            lastSavedAt: new Date(),
            error: null,
          })
          latest.current.onSaveSuccess?.(response)
          if (isCurrent) return response
        } catch (error) {
          const err =
            error instanceof Error ? error : new Error('Failed to save draft')
          setState((prev) => ({ ...prev, isSaving: false, error: err }))
          latest.current.onSaveError?.(err)
          return undefined
        } finally {
          clearTimeout(timer)
        }
      } while (true)
    }
    inFlight.current = run().finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [saveDraftMutation])
  useEffect(() => {
    if (!enabled) return
    timeoutRef.current = setTimeout(() => {
      void saveNow()
    }, AUTO_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timeoutRef.current)
  }, [signature, enabled, saveNow])
  return { ...state, saveNow }
}
