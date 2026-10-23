'use client'
import { useEffect, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import {
  uploadFile,
  compressImage,
  validateImageUploadFile,
  isValidImageSourceUrl,
  IMAGE_UPLOAD_FORMAT_HINT,
  isAbortError,
} from '@/lib/upload'
import { WritingDialog } from './WritingDialog'
import type { WritingWorkspace } from './useWritingWorkspace'
import type { ArticleStyle } from '@/lib/editor/articleAppearance'

export function WritingMedia({
  workspace: w,
  appearance,
}: {
  workspace: WritingWorkspace
  appearance: ArticleStyle
}) {
  const convex = useConvex()
  const [url, setUrl] = useState('')
  const [alt, setAlt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [width, setWidth] = useState(640)
  const [height, setHeight] = useState(480)
  const abort = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const open =
    w.showBodyImageDialog || w.showCoverImageDialog || w.showBodyYouTubeDialog
  useEffect(() => {
    if (open) {
      setUrl('')
      setAlt('')
      setError('')
    }
  }, [open])
  useEffect(() => () => abort.current?.abort(), [])
  function close() {
    if (busy) return
    w.setShowBodyImageDialog(false)
    w.setShowCoverImageDialog(false)
    w.setShowBodyYouTubeDialog(false)
  }
  function insertImage(src: string) {
    if (w.showCoverImageDialog) {
      w.setCoverImage(src)
      w.setHasUnsavedChanges(true)
    } else {
      w.editor?.chain().focus().setResizableImage({ src, alt }).run()
    }
    w.setShowBodyImageDialog(false)
    w.setShowCoverImageDialog(false)
  }
  async function upload(file: File) {
    const validation = validateImageUploadFile(file)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    setBusy(true)
    setError('')
    setProgress(0)
    const controller = new AbortController()
    abort.current = controller
    try {
      const compressed = await compressImage(file, 1200, 0.8, controller.signal)
      const result = await uploadFile(
        compressed,
        convex,
        'article_image',
        undefined,
        (p) => setProgress(p.percentage),
        controller.signal
      )
      if (!result.success || !result.url)
        throw new Error(result.error || 'Upload failed.')
      insertImage(result.url)
    } catch (e) {
      if (!isAbortError(e))
        setError(
          e instanceof Error ? e.message : 'Could not upload this image.'
        )
    } finally {
      setBusy(false)
      abort.current = null
    }
  }
  return (
    <WritingDialog
      open={!!open}
      onClose={close}
      title={
        w.showBodyYouTubeDialog
          ? 'Add a video'
          : w.showCoverImageDialog
            ? 'Add a cover image'
            : 'Add an image'
      }
      appearance={appearance}
      busy={busy}
    >
      {!w.showBodyYouTubeDialog && (
        <>
          <button
            className="insert-option"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Choose an image <span>From your device ↗</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
          <p className="muted">{IMAGE_UPLOAD_FORMAT_HINT}</p>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (w.showBodyYouTubeDialog) {
            let valid = false
            try {
              const parsed = new URL(url)
              valid =
                ['https:', 'http:'].includes(parsed.protocol) &&
                [
                  'www.youtube.com',
                  'youtube.com',
                  'youtu.be',
                  'www.youtube-nocookie.com',
                ].includes(parsed.hostname)
            } catch {}
            if (
              !valid ||
              !w.editor
                ?.chain()
                .focus()
                .setYoutubeVideo({ src: url, width, height })
                .run()
            ) {
              setError('Use a youtube.com or youtu.be video link.')
              return
            }
            close()
          } else {
            if (!isValidImageSourceUrl(url)) {
              setError('Enter a valid https:// image address.')
              return
            }
            insertImage(url)
          }
        }}
      >
        <label htmlFor="writing-media-url">
          {w.showBodyYouTubeDialog
            ? 'YouTube address'
            : 'Or use an image address'}
        </label>
        <input
          id="writing-media-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          required
          disabled={busy}
        />
        {w.showBodyYouTubeDialog ? (
          <>
            <label htmlFor="video-width">Video width</label>
            <input
              id="video-width"
              type="number"
              min={200}
              max={1920}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
            <label htmlFor="video-height">Video height</label>
            <input
              id="video-height"
              type="number"
              min={150}
              max={1080}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
          </>
        ) : (
          !w.showCoverImageDialog && (
            <>
              <label htmlFor="writing-image-alt">Image description</label>
              <input
                id="writing-image-alt"
                value={alt}
                maxLength={300}
                onChange={(e) => setAlt(e.target.value)}
                disabled={busy}
              />
            </>
          )
        )}
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Uploading image… {Math.round(progress)}%</p>}
        <button className="wine wide" disabled={busy}>
          {w.showBodyYouTubeDialog ? 'Add video' : 'Add image from address'}
        </button>
      </form>
    </WritingDialog>
  )
}
