'use client'

import { useMemo, useState } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import Link from 'next/link'
import AppNavigation from '@/components/layout/AppNavigation'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useUserDrafts } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { toast } from 'sonner'
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
import { DraftsListSkeleton } from '@/components/drafts/DraftsListSkeleton'
import { DraftListRow } from '@/components/drafts/DraftListRow'
import { DraftsSortControl } from '@/components/drafts/DraftsSortControl'
import { AUTO_SAVE_GUIDANCE } from '@/lib/autosave'
import { sortDraftsBy, type DraftSortKey } from '@/lib/drafts/draftMetadata'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { WorkspaceSurface } from '@/components/layout/WorkspaceSurface'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2 } from 'lucide-react'
import { mutationWithTimeout } from '@/lib/convexMutationWithTimeout'
import { ProtectedPageShell } from '@/components/layout/ProtectedPageShell'

export default function DraftsPage() {
  const { isAuthenticated, isLoading } = useAuth()

  const draftsQuery = useUserDrafts()
  const loading = draftsQuery === undefined

  const [sortKey, setSortKey] = useState<DraftSortKey>('updatedAt')

  const sortedDrafts = useMemo(() => {
    const drafts = draftsQuery ?? []
    return sortDraftsBy(drafts, sortKey)
  }, [draftsQuery, sortKey])

  const deleteArticleMutation = useMutation(api.articles.deleteArticle)
  const [deleteTarget, setDeleteTarget] = useState<Id<'articles'> | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return
    setIsDeleting(true)
    try {
      await mutationWithTimeout(deleteArticleMutation({ id: deleteTarget }))
      toast.success('Draft deleted')
      setDeleteTarget(null)
      setIsDeleting(false)
    } catch (error) {
      console.error('Failed to delete draft:', error)
      toast.error('Failed to delete draft. Please try again.')
      setIsDeleting(false)
    }
  }

  return (
    <ProtectedPageShell
      isLoading={isLoading}
      isAuthenticated={isAuthenticated}
      shellClassName="min-h-screen bg-muted/30"
      loadingContent={
        <WorkspaceSurface>
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-10 w-32" />
          </div>
          <DraftsListSkeleton />
        </WorkspaceSurface>
      }
    >
      <div className="min-h-screen bg-muted/30">
        <AppNavigation />
        <WorkspaceSurface>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-3xl font-bold text-foreground">Your drafts</h1>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild className="shrink-0 self-start sm:self-auto">
                    <Link href="/write">New article</Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  {AUTO_SAVE_GUIDANCE}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {loading ? (
            <DraftsListSkeleton />
          ) : (draftsQuery ?? []).length === 0 ? (
            <div className="rounded-[var(--card-radius)] border border-border bg-card px-6 py-12 text-center shadow-[var(--card-shadow)]">
              <p className="mb-2 text-lg font-medium text-foreground">
                No drafts yet
              </p>
              <p className="mb-6 text-sm text-muted-foreground">
                Unpublished articles are saved here automatically.{' '}
                {AUTO_SAVE_GUIDANCE}.
              </p>
              <Link
                href="/write"
                className="text-sm font-medium text-brand-blue hover:text-brand-accent"
              >
                Start writing your first article
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <DraftsSortControl value={sortKey} onChange={setSortKey} />
              </div>
              <div className="space-y-3">
                {sortedDrafts.map((draft) => (
                  <DraftListRow
                    key={draft._id}
                    draft={draft}
                    onDelete={setDeleteTarget}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>
            </>
          )}
        </WorkspaceSurface>

        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (isDeleting) return
            if (!open) setDeleteTarget(null)
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
              <AlertDialogCancel disabled={isDeleting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                className={cn(
                  buttonVariants({ variant: 'destructive' }),
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
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
      </div>
    </ProtectedPageShell>
  )
}
