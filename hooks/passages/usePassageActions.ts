'use client'

import { useMemo } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { showToast } from '@/system/toast'
import { passageActions } from './passageActions'

/**
 * Keep, remove (with Undo), restore, appreciate and note a line, over the
 * highlight mutations. Every outcome is said once, by a toast; with
 * `quiet`, failures only (the control's own state says the rest).
 */
export function usePassageActions({ quiet = false }: { quiet?: boolean } = {}) {
  const create = useMutation(api.highlights.createHighlight)
  const remove = useMutation(api.highlights.deleteHighlight)
  const restore = useMutation(api.highlights.restoreHighlight)
  const appreciate = useMutation(api.highlights.setPassageAppreciation)
  const update = useMutation(api.highlights.updateHighlight)
  return useMemo(
    () =>
      passageActions<Id<'highlights'>>(
        {
          create: (args) =>
            create({ ...args, articleId: args.articleId as Id<'articles'> }),
          remove,
          restore,
          appreciate,
          update,
        },
        showToast,
        { quiet }
      ),
    [create, remove, restore, appreciate, update, quiet]
  )
}
