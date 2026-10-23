'use client'
import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useListArticles, useUserDrafts } from '@/hooks/convex/useArticles'
import type { Id } from '@/types/convex'
import { WritingDialog } from './WritingDialog'
import type { ArticleStyle } from '@/lib/editor/articleAppearance'

export function WritingDesk({
  articleId,
  username,
  onNew,
  onDownload,
  appearance,
  onDeleted,
}: {
  articleId?: string
  username?: string
  onNew: () => void
  onDownload: () => void
  appearance: ArticleStyle
  onDeleted: (id: string) => void
}) {
  const drafts = useUserDrafts()
  const [page, setPage] = useState(1)
  const publications = useListArticles(
    username ? { author: username, page, limit: 20 } : 'skip'
  )
  const deleteArticle = useMutation(api.articles.deleteArticle)
  const [pending, setPending] = useState<{
    id: Id<'articles'>
    title: string
    published?: boolean
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    if (!pending || deleting) return
    setDeleting(true)
    setError('')
    try {
      await deleteArticle({ id: pending.id })
      onDeleted(pending.id)
      setPending(null)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not delete this draft. Please try again.'
      )
    } finally {
      setDeleting(false)
    }
  }
  return (
    <>
      <p className="muted">Saved to your QuillTip account.</p>
      <button className="wine wide" onClick={onNew}>
        ＋ New draft
      </button>
      <button className="wide" onClick={onDownload}>
        Download a copy ↓
      </button>
      <h3 className="writing-group">Drafts</h3>
      {drafts === undefined ? (
        <p role="status" className="empty-writing">
          Loading your drafts…
        </p>
      ) : drafts.length === 0 ? (
        <p className="empty-writing">
          Your next story starts here. Drafts you save will appear in this
          space.
        </p>
      ) : (
        [...drafts]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((draft) => (
            <div
              key={draft._id}
              className={`draft-row ${articleId === draft._id ? 'current' : ''}`}
            >
              <a
                className="draft-open"
                href={`/write?id=${encodeURIComponent(draft._id)}`}
              >
                <strong>{draft.title || 'Untitled draft'}</strong>
                <small>
                  {new Date(draft.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </small>
              </a>
              <button
                className="draft-delete"
                aria-label={`Delete ${draft.title}`}
                onClick={() =>
                  setPending({ id: draft._id, title: draft.title })
                }
              >
                Delete
              </button>
            </div>
          ))
      )}
      <h3 className="writing-group">Published</h3>
      {!publications ? (
        <p className="empty-writing" role="status">
          Loading publications…
        </p>
      ) : publications.articles.length === 0 ? (
        <p className="empty-writing">
          When you share a story, it will live here.
        </p>
      ) : (
        publications.articles.map((article) => (
          <div className="publication-row" key={article._id}>
            <strong>{article.title}</strong>
            <small>
              Public ·{' '}
              {new Date(
                article.publishedAt ?? article.updatedAt
              ).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </small>
            <div className="publication-actions">
              <a href={`/write?id=${encodeURIComponent(article._id)}`}>Edit</a>
              <a
                href={`/${article.authorUsername ?? username}/${article.slug}`}
              >
                View article ↗
              </a>
              <button
                aria-label={`Delete ${article.title}`}
                onClick={() => {
                  setError('')
                  setPending({
                    id: article._id,
                    title: article.title,
                    published: true,
                  })
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
      {publications && publications.totalPages > 1 && (
        <div className="publication-actions">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            {page} / {publications.totalPages}
          </span>
          <button
            disabled={page >= publications.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
      <WritingDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={
          pending?.published ? 'Delete this article?' : 'Delete this draft?'
        }
        appearance={appearance}
        busy={deleting}
      >
        <p>
          “{pending?.title}” will be permanently deleted from your account.
          Download a copy first if you want to keep it.
        </p>
        {pending?.published && (
          <p className="muted">
            This removes the article from QuillTip. Its permanent Arweave
            snapshot cannot be removed.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="wine wide"
          disabled={deleting}
          onClick={() => void remove()}
        >
          {deleting
            ? 'Deleting…'
            : pending?.published
              ? 'Delete article'
              : 'Delete draft'}
        </button>
        <button
          className="wide"
          disabled={deleting}
          onClick={() => setPending(null)}
        >
          Keep writing
        </button>
      </WritingDialog>
    </>
  )
}
