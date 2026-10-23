'use client'
/* Full document navigation resets draft state after the unsaved-changes guard. */
/* eslint-disable @next/next/no-html-link-for-pages */
/* User-selected cover URLs are displayed directly in the private preview. */
/* eslint-disable @next/next/no-img-element */
import { useState, useRef, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { WritingPreview } from './WritingPreview'
import {
  getArticleAppearance,
  setArticleAppearance,
  articleAppearanceClasses,
  PAPER_COLORS,
  PAPER_SWATCH_CLASSES,
  type ArticleStyle,
} from '@/lib/editor/articleAppearance'
import {
  clearDraftBackup,
  readDraftBackup,
  writeDraftBackup,
} from '@/lib/draftBackup'
import type { WritingWorkspace } from './useWritingWorkspace'
import { WritingBrand } from './WritingBrand'
import { WritingLoading } from './WritingLoading'
import { WritingDialog } from './WritingDialog'
import { WritingToolbar } from './WritingToolbar'
import { WritingDesk } from './WritingDesk'
import { WritingMedia } from './WritingMedia'
import { WritingWallet } from './WritingWallet'

export function WritingWorkspaceView({
  workspace: w,
}: {
  workspace: WritingWorkspace
}) {
  const [panel, setPanel] = useState<
    | 'appearance'
    | 'writing'
    | 'preview'
    | 'insert'
    | 'link'
    | 'publish'
    | 'notes'
    | null
  >(w.initialWritingOpen ? 'writing' : null)
  const [focus, setFocus] = useState(false)
  const [format, setFormat] = useState(false)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState('')
  const [leaving, setLeaving] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const appearance = getArticleAppearance(w.editorContent)
  const [localAppearance, setLocalAppearance] = useState<ArticleStyle | null>(
    null
  )
  const style = localAppearance ?? appearance
  useEffect(() => {
    setLocalAppearance(null)
  }, [w.editorContent])
  useEffect(() => {
    let active = true
    const resize = () => {
      if (!active) return
      for (const element of [titleRef.current, w.excerptTextareaRef.current]) {
        if (element) {
          element.style.height = 'auto'
          element.style.height = `${element.scrollHeight}px`
        }
      }
    }
    resize()
    window.addEventListener('resize', resize)
    void document.fonts?.ready.then(resize)
    return () => {
      active = false
      window.removeEventListener('resize', resize)
    }
  }, [w.title, w.excerpt, w.excerptTextareaRef, style.type])
  useEffect(() => {
    w.editor?.setEditable(!w.isPublishing, false)
  }, [w.editor, w.isPublishing])
  function changeAppearance(patch: Partial<ArticleStyle>) {
    if (!w.editor) return
    const next = { ...getArticleAppearance(w.editor.getJSON()), ...patch }
    setLocalAppearance(next)
    setArticleAppearance(w.editor, next)
  }
  function download() {
    const doc = document.implementation.createHTMLDocument(
      w.title || 'QuillTip draft'
    )
    const charset = doc.createElement('meta')
    charset.setAttribute('charset', 'utf-8')
    doc.head.prepend(charset)
    const title = doc.createElement('h1')
    title.textContent = w.title || 'Untitled draft'
    const subtitle = doc.createElement('p')
    subtitle.textContent = w.excerpt
    const article = doc.createElement('article')
    article.innerHTML = w.editor?.getHTML() || ''
    doc.body.append(title, subtitle, article)
    if (w.coverImage) {
      const cover = doc.createElement('img')
      cover.src = w.coverImage
      cover.alt = style.coverAlt
      doc.body.prepend(cover)
    }
    if (w.writerNotes) {
      const notes = doc.createElement('aside')
      const heading = doc.createElement('h2')
      heading.textContent = 'Private notes'
      const text = doc.createElement('p')
      text.textContent = w.writerNotes
      notes.append(heading, text)
      doc.body.append(notes)
    }
    const url = URL.createObjectURL(
      new Blob(['<!doctype html>' + doc.documentElement.outerHTML], {
        type: 'text/html;charset=utf-8',
      })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `${(w.title || 'QuillTip draft').replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 80)}.html`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function newDraft() {
    if (leaving || w.isSaving) return
    if (w.recoveryDeferredRef.current) {
      const backup = readDraftBackup()
      if (backup) {
        close()
        w.setBackupPrompt(backup)
        return
      }
    }
    setLeaving(true)
    try {
      if (w.hasUnsavedChanges) {
        const saved = await w.saveNow()
        if (!saved) return
      }
      clearDraftBackup()
      w.hasUnsavedRef.current = false
      w.setHasUnsavedChanges(false)
      window.location.assign('/write')
    } finally {
      setLeaving(false)
    }
  }
  async function saveAndLeave() {
    setLeaving(true)
    try {
      const saved = await w.saveNow()
      if (saved) {
        w.hasUnsavedRef.current = false
        w.setHasUnsavedChanges(false)
        w.confirmLeaveNavigation()
      }
    } finally {
      setLeaving(false)
    }
  }
  const words =
    w.editor?.getText().trim().split(/\s+/).filter(Boolean).length ?? 0
  const date = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const close = () => setPanel(null)
  if (w.draftLoading)
    return <WritingLoading message="Opening your saved draft…" />
  if (w.draftUnavailable)
    return (
      <div className="writing-workspace">
        <header className="topbar">
          <WritingBrand />
        </header>
        <main>
          <div className="sheet">
            <h1>This draft isn’t available.</h1>
            <p>It may have been deleted or belong to another account.</p>
            {w.backupPrompt && (
              <>
                <p>
                  A local copy is still available on this device. You can
                  recover its words as a new private draft.
                </p>
                <button
                  className="wine wide"
                  onClick={() => {
                    if (!w.backupPrompt) return
                    writeDraftBackup({
                      ...w.backupPrompt,
                      articleId: undefined,
                    })
                    window.location.assign('/write')
                  }}
                >
                  Recover as a new draft
                </button>
                <button
                  className="wide"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(w.backupPrompt, null, 2)], {
                        type: 'application/json',
                      })
                    )
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'quilltip-draft-backup.json'
                    a.click()
                    setTimeout(() => URL.revokeObjectURL(url), 1000)
                  }}
                >
                  Download local backup
                </button>
                <button
                  className="wide"
                  onClick={() => {
                    w.handleDiscardBackup()
                    window.location.assign('/write?desk=writing')
                  }}
                >
                  Discard local backup
                </button>
              </>
            )}
            <a className="editor-return" href="/write?desk=writing">
              Your writing ↗
            </a>
          </div>
        </main>
      </div>
    )
  const publicationHref =
    w.publishUsername && w.publishSlug
      ? `/${w.publishUsername}/${w.publishSlug}`
      : undefined
  return (
    <div
      className={`writing-workspace ${articleAppearanceClasses(style)} ${focus ? 'focus-mode' : ''}`}
    >
      <header className="topbar">
        <WritingBrand />
        <div className="actions">
          <span id="save-status" role="status">
            {w.isSaving
              ? 'Saving…'
              : w.error
                ? 'Couldn’t save — keep a copy'
                : w.hasUnsavedChanges
                  ? 'Unsaved changes'
                  : w.lastSavedAt || w.articleId
                    ? 'Saved to your account'
                    : 'Your words start here'}
          </span>
          <button
            id="save-draft"
            title="Save draft (⌘/Ctrl S)"
            disabled={w.isSaving || w.isPublishing || !w.editor}
            onClick={() => void w.saveNow()}
          >
            Save draft
          </button>
          <button id="appearance" onClick={() => setPanel('appearance')}>
            Appearance <span aria-hidden="true">◐</span>
          </button>
          <button
            id="preview"
            className="wine"
            disabled={!w.editor}
            onClick={() => setPanel('preview')}
          >
            Preview <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>
      <nav className="editor-destinations" aria-label="Main navigation">
        <a href="/articles">Articles</a>
        <a href="/library">Your library</a>
        <a href="/write" aria-current="page">
          Writing desk
        </a>
      </nav>
      <nav className="desk-nav" aria-label="Writing tools">
        <button onClick={() => setPanel('writing')}>
          ☰ <span>Your writing</span>
        </button>
        <div>
          <button aria-expanded={format} onClick={() => setFormat((v) => !v)}>
            Aa <span>Format</span>
          </button>
          <button
            id="focus"
            aria-pressed={focus}
            onClick={() => setFocus((v) => !v)}
          >
            Focus
          </button>
          <button onClick={() => setPanel('insert')}>
            ＋ <span>Insert</span>
          </button>
        </div>
      </nav>
      {w.error && (
        <div className="writer-notice" role="alert">
          <strong>Your latest changes haven’t saved.</strong>
          <p>{w.error.message}</p>
          <button onClick={() => void w.saveNow()} disabled={w.isSaving}>
            Retry saving
          </button>
          <button onClick={download}>Download a copy</button>
        </div>
      )}
      {w.bodyUploadAnnouncement && (
        <div
          className="writer-notice"
          role={w.bodyUploadAnnouncement.type === 'error' ? 'alert' : 'status'}
        >
          {w.bodyUploadAnnouncement.text}
        </div>
      )}
      {w.publishFeedback && (
        <div className="writer-notice" role="alert">
          <strong>{w.publishFeedback.title}</strong>
          <p>{w.publishFeedback.detail}</p>
        </div>
      )}
      <main>
        <div className="margin-note" aria-hidden="true">
          One thought
          <br />
          at a time.
          <svg viewBox="0 0 120 70">
            <path d="M10 10Q10 68 102 45m-12-8 15 7-9 14" />
          </svg>
        </div>
        <article className="sheet">
          <div className="paper-heading">
            <span>
              {w.publishStatus.published
                ? 'PUBLISHED ARTICLE'
                : 'PRIVATE DRAFT'}
            </span>
            <span>{date}</span>
          </div>
          <div id="field-article-title">
            <label className="sr-only" htmlFor="article-title">
              Article title
            </label>
            <textarea
              ref={titleRef}
              rows={1}
              id="article-title"
              placeholder="Give it a title"
              maxLength={200}
              value={w.title}
              disabled={w.isPublishing}
              aria-invalid={!!w.titleError}
              aria-describedby={
                w.titleError ? 'article-title-error' : undefined
              }
              onChange={(e) => {
                w.setTitle(e.target.value)
                w.setTitleError(null)
                w.setHasUnsavedChanges(true)
              }}
            />
            {w.titleError && (
              <p id="article-title-error" role="alert">
                {w.titleError}
              </p>
            )}
          </div>
          <label className="sr-only" htmlFor="article-subtitle">
            Subtitle (optional)
          </label>
          <textarea
            ref={w.excerptTextareaRef}
            rows={1}
            id="article-subtitle"
            placeholder="A subtitle, if you like"
            maxLength={500}
            value={w.excerpt}
            disabled={w.isPublishing}
            onChange={(e) => {
              w.setExcerpt(e.target.value)
              w.setHasUnsavedChanges(true)
            }}
          />
          <div className="rule" />
          <div
            className={
              w.bodyImageDragging ? 'writer-drop dragging' : 'writer-drop'
            }
            onDragOver={w.handleBodyEditorDragOver}
            onDragLeave={w.handleBodyEditorDragLeave}
            onDrop={w.handleBodyEditorDrop}
          >
            <EditorContent editor={w.editor} />
          </div>
          <footer className="paper-footer">
            <span>
              {words} {words === 1 ? 'word' : 'words'}
              {words > 0
                ? ` · ${Math.max(1, Math.ceil(words / 200))} min read`
                : ''}
            </span>
            <span>
              {w.publishStatus.published
                ? 'Changes save to your live article'
                : 'Only you can see this draft'}
            </span>
          </footer>
        </article>
      </main>
      <footer className="trial-footer">
        Your writing, saved to your account.
        <button onClick={() => setPanel('notes')}>Private notes</button>
      </footer>
      {format && w.editor && (
        <WritingToolbar
          editor={w.editor}
          onClose={() => setFormat(false)}
          onLink={() => {
            setLink(w.editor?.getAttributes('link').href || '')
            setLinkError('')
            setPanel('link')
          }}
        />
      )}
      <WritingDialog
        open={panel === 'appearance'}
        onClose={close}
        title="Make it yours."
        kind="drawer"
        appearance={style}
      >
        <p className="muted">Style your article. See it in your preview.</p>
        <fieldset>
          <legend>Page color</legend>
          <div className="swatches">
            {Object.keys(PAPER_COLORS).map((key) => (
              <label
                key={key}
                aria-label={key.charAt(0).toUpperCase() + key.slice(1)}
              >
                <input
                  type="radio"
                  name="paper"
                  value={key}
                  checked={style.paper === key}
                  onChange={() =>
                    changeAppearance({ paper: key as ArticleStyle['paper'] })
                  }
                />
                <span
                  className={PAPER_SWATCH_CLASSES[key as ArticleStyle['paper']]}
                />
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Article typography</legend>
          {(['literary', 'modern'] as const).map((type) => (
            <label
              key={type}
              className="font-choice"
              aria-label={type === 'literary' ? 'Literary' : 'Modern'}
            >
              <input
                type="radio"
                name="type"
                checked={style.type === type}
                onChange={() => changeAppearance({ type })}
              />
              <span>
                <strong
                  className={
                    type === 'literary'
                      ? '[font-family:Writing_Literata]'
                      : undefined
                  }
                >
                  {type === 'literary' ? 'Literary' : 'Modern'}
                </strong>
                <small>
                  {type === 'literary'
                    ? 'Expressive title, comfortable serif text'
                    : 'Syne title, clean sans-serif text'}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="appearance-sample">
          <small>LIVE SAMPLE</small>
          <h3>{w.title || 'Your story, your style.'}</h3>
          <p>
            A familiar place. A different perspective. The beginning of
            something worth sharing.
          </p>
        </div>
        <p className="drawer-note">
          These choices save with your draft and carry into your preview. Focus
          mode only changes your writing workspace.
        </p>
        <button id="appearance-done" className="wine wide" onClick={close}>
          Back to writing
        </button>
      </WritingDialog>
      <WritingDialog
        open={panel === 'writing'}
        onClose={close}
        title="Your writing"
        kind="drawer left"
        appearance={style}
        busy={leaving}
      >
        {panel === 'writing' && (
          <WritingDesk
            articleId={w.articleId}
            username={w.currentUser?.username}
            onNew={() => void newDraft()}
            onDownload={download}
            appearance={style}
            onDeleted={(id) => {
              if (id === w.articleId) {
                clearDraftBackup()
                w.hasUnsavedRef.current = false
                w.setHasUnsavedChanges(false)
                window.location.assign('/write?desk=writing')
              }
            }}
          />
        )}
      </WritingDialog>
      <WritingDialog
        open={panel === 'preview'}
        onClose={close}
        title="Article preview"
        kind="preview-dialog"
        appearance={style}
        header={false}
      >
        <div className="preview-header">
          <strong>Article preview</strong>
          <div>
            <button onClick={close}>Back to writing</button>
            <button className="wine" onClick={() => setPanel('publish')}>
              {w.publishStatus.published
                ? 'Article settings'
                : 'Continue to publish ↗'}
            </button>
          </div>
        </div>
        <article className="sheet">
          <h1>{w.title || 'Untitled draft'}</h1>
          {w.excerpt && <p className="preview-subtitle">{w.excerpt}</p>}
          {w.coverImage && (
            <img
              className="article-cover"
              src={w.coverImage}
              alt={style.coverAlt}
            />
          )}
          {w.editorContent && <WritingPreview content={w.editorContent} />}
        </article>
        <p className="preview-note">
          {w.publishStatus.published
            ? 'Preview of your published article. Changes save to the live article.'
            : 'Preview only. Nothing has been published.'}
        </p>
      </WritingDialog>
      <WritingDialog
        open={panel === 'insert'}
        onClose={close}
        title="Add to your story"
        appearance={style}
      >
        <button
          className="insert-option"
          onClick={() => {
            close()
            w.setShowBodyImageDialog(true)
          }}
        >
          Image <span>From your device ↗</span>
        </button>
        <button
          className="insert-option"
          onClick={() => {
            close()
            w.editor?.chain().focus().setHorizontalRule().run()
          }}
        >
          Divider <span>A pause between thoughts</span>
        </button>
        <button
          className="insert-option"
          onClick={() => {
            close()
            w.setShowBodyYouTubeDialog(true)
          }}
        >
          Video <span>Embed from YouTube ↗</span>
        </button>
        <p className="muted">
          Images upload to your account and save with your draft.
        </p>
      </WritingDialog>
      <WritingDialog
        open={panel === 'link'}
        onClose={close}
        title="Add a link"
        appearance={style}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            try {
              const url = new URL(link)
              if (!['http:', 'https:', 'mailto:'].includes(url.protocol))
                throw new Error()
              w.editor
                ?.chain()
                .focus()
                .extendMarkRange('link')
                .setLink({ href: link })
                .run()
              close()
            } catch {
              setLinkError('Enter a valid https:// website address.')
            }
          }}
        >
          <label htmlFor="link-url">Website address</label>
          <input
            id="link-url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
            required
          />
          {linkError && <p role="alert">{linkError}</p>}
          <button className="wine wide">Add link</button>
          <button
            type="button"
            className="wide"
            onClick={() => {
              w.editor?.chain().focus().unsetLink().run()
              close()
            }}
          >
            Remove link
          </button>
        </form>
      </WritingDialog>
      <WritingDialog
        open={panel === 'notes'}
        onClose={close}
        title="Room for a thought."
        kind="drawer"
        appearance={style}
      >
        <p className="muted">
          Private notes for this draft. Only you can see them.
        </p>
        <label className="sr-only" htmlFor="writer-notes">
          Private notes
        </label>
        <textarea
          id="writer-notes"
          className="writer-notes"
          value={w.writerNotes}
          onChange={(e) => {
            w.setWriterNotes(e.target.value)
            w.setHasUnsavedChanges(true)
          }}
        />
        <button className="wine wide" onClick={close}>
          Back to writing
        </button>
      </WritingDialog>
      <WritingDialog
        open={
          panel === 'publish' &&
          !w.publishConfirmOpen &&
          !w.publishSuccessVisible
        }
        onClose={close}
        title="Ready to share?"
        kind="drawer"
        appearance={style}
        modal={!w.suspendDialogModalForWallet}
      >
        <p className="muted">
          A few details before your story meets its readers.
        </p>
        <form
          id="publish-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (w.publishStatus.published) {
              void w.saveNow()
              return
            }
            if (
              !w.tags
                .split(',')
                .some((tag) =>
                  ['Stories', 'Thoughts', 'Anecdotes'].includes(tag.trim())
                )
            ) {
              w.setTags(['Stories', w.tags].filter(Boolean).join(', '))
              w.setHasUnsavedChanges(true)
            }
            w.requestPublish()
          }}
        >
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={
              ['Stories', 'Thoughts', 'Anecdotes'].includes(
                w.tags.split(',')[0] ?? ''
              )
                ? w.tags.split(',')[0]
                : 'Stories'
            }
            onChange={(e) => {
              const rest = w.tags
                .split(',')
                .map((t) => t.trim())
                .filter(
                  (t) => t && !['Stories', 'Thoughts', 'Anecdotes'].includes(t)
                )
              w.setTags([e.target.value, ...rest].join(', '))
              w.setHasUnsavedChanges(true)
            }}
          >
            <option>Stories</option>
            <option>Thoughts</option>
            <option>Anecdotes</option>
          </select>
          <label htmlFor="writing-tags">Tags</label>
          <input
            id="writing-tags"
            value={w.tags}
            placeholder="Comma-separated tags"
            onChange={(e) => {
              w.setTags(e.target.value)
              w.setHasUnsavedChanges(true)
            }}
          />
          <label htmlFor="visibility">Who can find it?</label>
          <select id="visibility" value="public" onChange={() => {}}>
            <option value="public">Everyone · listed in Articles</option>
            <option value="unlisted" disabled>
              Unlisted · not yet available
            </option>
          </select>
          <p className="muted">
            Published articles are public. If you leave the subtitle blank, the
            opening text becomes the preview on article cards.
          </p>
          <label htmlFor="publish-subtitle">Subtitle (optional)</label>
          <input
            id="publish-subtitle"
            value={w.excerpt}
            maxLength={500}
            onChange={(e) => {
              w.setExcerpt(e.target.value)
              w.setHasUnsavedChanges(true)
            }}
          />
          <div id="cover-preview">
            {w.coverImage && <img src={w.coverImage} alt={style.coverAlt} />}
          </div>
          <button
            type="button"
            className="wide"
            onClick={() => w.setShowCoverImageDialog(true)}
          >
            {w.coverImage
              ? 'Change cover image'
              : '＋ Add cover image (optional)'}
          </button>
          {w.coverImage && (
            <button
              type="button"
              className="wide"
              onClick={() => {
                w.setCoverImage('')
                w.setHasUnsavedChanges(true)
              }}
            >
              Remove cover
            </button>
          )}
          <label htmlFor="cover-alt">Cover description</label>
          <input
            id="cover-alt"
            value={style.coverAlt}
            placeholder="Describe the image for readers"
            maxLength={300}
            onChange={(e) => changeAppearance({ coverAlt: e.target.value })}
          />
          {w.receivingWalletAddress === undefined ? (
            <p role="status" className="muted">
              Checking your receiving wallet…
            </p>
          ) : w.receivingWalletAddress ? (
            <p className="drawer-note">
              Your receiving wallet is ready for Stellar testnet tips.
            </p>
          ) : (
            <WritingWallet onSaved={w.setReceivingWalletAddress} />
          )}
          {w.titleError && <p role="alert">{w.titleError}</p>}
          {w.publishFeedback && (
            <p role="alert">
              {w.publishFeedback.title} {w.publishFeedback.detail}
            </p>
          )}
          <button
            className="wine wide"
            disabled={
              w.isSaving ||
              (!w.publishStatus.published && !w.receivingWalletAddress)
            }
          >
            {w.publishStatus.published ? 'Save changes' : 'Review publication'}
          </button>
        </form>
      </WritingDialog>
      <WritingDialog
        open={w.publishConfirmOpen}
        onClose={() => w.setPublishConfirmOpen(false)}
        title="One last look."
        appearance={style}
        busy={w.isPublishing}
      >
        <h3>{w.title}</h3>
        <p>{w.excerpt}</p>
        <p className="muted">
          Publishing stores your content on Arweave (permanent storage). You
          cannot undo this or remove that snapshot from Arweave.
        </p>
        {w.publishFeedback && (
          <p role="alert">
            {w.publishFeedback.title} {w.publishFeedback.detail}
          </p>
        )}
        <button
          className="wine wide"
          disabled={w.isPublishing || !w.receivingWalletAddress}
          onClick={() => void w.handlePublish()}
        >
          {w.isPublishing ? 'Publishing…' : 'Publish article'}
        </button>
        <button
          className="wide"
          disabled={w.isPublishing}
          onClick={() => w.setPublishConfirmOpen(false)}
        >
          Back to settings
        </button>
      </WritingDialog>
      <WritingDialog
        open={w.publishSuccessVisible}
        onClose={() => {
          w.setPublishSuccessVisible(false)
          close()
        }}
        title="Your article is ready."
        appearance={style}
      >
        <p>Your article is published and ready for readers.</p>
        {publicationHref ? (
          <a className="wine wide published-link" href={publicationHref}>
            View article ↗
          </a>
        ) : (
          <p role="status">Preparing your article link…</p>
        )}
        <button
          className="wide"
          onClick={() => {
            w.setPublishSuccessVisible(false)
            close()
          }}
        >
          Back to writing
        </button>
      </WritingDialog>
      <WritingDialog
        open={!!w.backupPrompt}
        onClose={() => {
          w.recoveryDeferredRef.current = true
          w.setBackupPrompt(null)
        }}
        title="Your words are still here."
        appearance={style}
      >
        <p>
          A newer local copy of “{w.backupPrompt?.title}” was found. Restore it
          to continue where you left off.
        </p>
        <button className="wine wide" onClick={w.handleRestoreBackup}>
          Restore draft
        </button>
        <button className="wide" onClick={w.handleDiscardBackup}>
          Discard local copy
        </button>
      </WritingDialog>
      <WritingDialog
        open={!!w.navConfirm}
        onClose={() => w.setNavConfirm(null)}
        title="Keep your latest words?"
        appearance={style}
        busy={leaving}
      >
        <p>You have changes that haven’t saved to your account.</p>
        {w.error && <p role="alert">{w.error.message}</p>}
        <button
          className="wine wide"
          disabled={leaving}
          onClick={() => void saveAndLeave()}
        >
          {leaving ? 'Saving…' : 'Save and continue'}
        </button>
        <button
          className="wide"
          disabled={leaving}
          onClick={() => {
            download()
            w.confirmLeaveNavigation()
          }}
        >
          Download a copy and leave
        </button>
        <button
          className="wide"
          disabled={leaving}
          onClick={() => w.setNavConfirm(null)}
        >
          Keep writing
        </button>
      </WritingDialog>
      <WritingMedia workspace={w} appearance={style} />
    </div>
  )
}
