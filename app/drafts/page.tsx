'use client'

import { useState } from 'react'
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

export default function DraftsPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  // Fetch drafts using Convex query
  const drafts = useUserDrafts() || []
  const loading = drafts === undefined

  // Convex mutation for deleting articles
  const deleteArticleMutation = useMutation(api.articles.deleteArticle)
  const [deleteTarget, setDeleteTarget] = useState<Id<'articles'> | null>(null)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated && !isLoading) {
    router.push('/login')
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
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">Your Drafts</h1>
          <Link
            href="/write"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            New Article
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-muted-foreground">Loading drafts...</div>
          </div>
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
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-foreground mb-2">
                      {draft.title || 'Untitled'}
                    </h2>
                    {draft.excerpt && (
                      <p className="text-muted-foreground mb-3 line-clamp-2">
                        {draft.excerpt}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
                  <div className="flex gap-2 ml-4">
                    <Link
                      href={`/write?id=${draft._id}`}
                      className="px-4 py-2 rounded-lg border border-primary text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => setDeleteTarget(draft._id)}
                      className="px-4 py-2 rounded-lg border border-destructive text-destructive bg-destructive/5 hover:bg-destructive/10 transition-colors"
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
            <li>• Drafts are auto-saved every 30 seconds while you write</li>
            <li>
              • Delete drafts you no longer need to keep your workspace clean
            </li>
          </ul>
        </div>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async () => {
                if (!deleteTarget) return
                try {
                  await deleteArticleMutation({ id: deleteTarget })
                  toast.success('Draft deleted')
                } catch (error) {
                  console.error('Failed to delete draft:', error)
                  toast.error('Failed to delete draft. Please try again.')
                } finally {
                  setDeleteTarget(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
