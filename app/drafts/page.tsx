'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { AUTO_SAVE_GUIDANCE } from '@/lib/autosave'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { mutationWithTimeout } from '@/lib/convexMutationWithTimeout'

export default function DraftsPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  const draftsQuery = useUserDrafts()
  const loading = draftsQuery === undefined
  const drafts = draftsQuery ?? []

  // Convex mutation for deleting articles
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

  useEffect(() => {
    if (isLoading || isAuthenticated) return
    router.replace('/login')
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30">
        <AppNavigation />
        <div className="max-w-5xl mx-auto pt-24 pb-8 px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-8">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-10 w-32" />
          </div>
          <DraftsListSkeleton />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <AppNavigation />
      <div className="max-w-5xl mx-auto pt-24 pb-8 px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">Your Drafts</h1>
          <Link
            href="/write"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shrink-0 self-start sm:self-auto"
          >
            New Article
          </Link>
        </div>

        {loading ? (
          <DraftsListSkeleton />
        ) : drafts.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)]">
            <div className="text-muted-foreground mb-4">No drafts yet</div>
            <Link
              href="/write"
              className="text-primary hover:text-primary/80 font-medium"
            >
              Start writing your first article →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {drafts.map((draft) => (
              <div
                key={draft._id}
                className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border ring-1 ring-border/60 p-[var(--card-padding)] hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
                  <div className="min-w-0 flex-1 w-full">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h2 className="text-xl font-semibold text-foreground break-words min-w-0 flex-1">
                        {draft.title || 'Untitled'}
                      </h2>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="sm:hidden shrink-0"
                            aria-label="Draft actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="min-w-[10rem]"
                        >
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/write?id=${draft._id}`}
                              className="cursor-pointer gap-2"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer gap-2 text-destructive focus:text-destructive disabled:opacity-50 disabled:pointer-events-none"
                            disabled={isDeleting}
                            onSelect={() => {
                              if (isDeleting) return
                              setDeleteTarget(draft._id)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {draft.excerpt && (
                      <p className="text-muted-foreground mb-3 line-clamp-2">
                        {draft.excerpt}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span>
                        Created:{' '}
                        {formatDate(
                          new Date(draft._creationTime).toISOString()
                        )}
                      </span>
                      <span>•</span>
                      <span>
                        Last saved:{' '}
                        {formatDate(new Date(draft.updatedAt).toISOString())}
                      </span>
                      {!draft.published && (
                        <>
                          <span>•</span>
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            Draft
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:flex gap-2 shrink-0">
                    <Link
                      href={`/write?id=${draft._id}`}
                      className="px-4 py-2 rounded-lg border border-primary text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setDeleteTarget(draft._id)}
                      className="px-4 py-2 rounded-lg border border-destructive text-destructive bg-destructive/5 hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 text-sm text-muted-foreground bg-muted border border-border p-4 rounded-lg">
          <p className="font-semibold mb-2">About Drafts</p>
          <ul className="space-y-1">
            <li>
              • All your unpublished articles are saved here automatically
            </li>
            <li>• Click &quot;Edit&quot; to continue working on any draft</li>
            <li>• {AUTO_SAVE_GUIDANCE}</li>
            <li>
              • Delete drafts you no longer need to keep your workspace clean
            </li>
          </ul>
        </div>
      </div>

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
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
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
  )
}
