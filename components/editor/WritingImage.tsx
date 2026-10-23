'use client'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from '@tiptap/react'
import { useState, useRef, useEffect } from 'react'
import { useConvex } from 'convex/react'
import { ResizableImage, parseNumericAttr } from './extensions/ResizableImage'
import { WritingDialog } from './WritingDialog'
import { getArticleAppearance } from '@/lib/editor/articleAppearance'
import {
  validateImageUploadFile,
  compressImage,
  uploadFile,
} from '@/lib/upload'

function WritingImageView({
  node,
  editor,
  selected,
  updateAttributes,
  deleteNode,
  getPos,
}: ReactNodeViewProps) {
  const [open, setOpen] = useState(false),
    [description, setDescription] = useState(''),
    [caption, setCaption] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const imageButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected && editor.storage.resizableImage.shouldFocus) {
      imageButton.current?.focus()
      editor.storage.resizableImage.shouldFocus = false
    }
  }, [selected, editor])
  const image = useRef<HTMLImageElement>(null),
    file = useRef<HTMLInputElement>(null)
  const start = useRef<{ x: number; width: number } | null>(null)
  const [displayWidth, setDisplayWidth] = useState(
    parseNumericAttr(node.attrs.width) ?? 600
  )
  const convex = useConvex()
  useEffect(
    () => setDisplayWidth(parseNumericAttr(node.attrs.width) ?? 600),
    [node.attrs.width]
  )
  const clamp = (value: number) =>
    Math.round(Math.max(100, Math.min(1200, value)))
  function resize(width: number) {
    const next = clamp(width)
    setDisplayWidth(next)
    const ratio =
      image.current && image.current.naturalWidth > 0
        ? image.current.naturalHeight / image.current.naturalWidth
        : 1
    updateAttributes({ width: next, height: Math.round(next * ratio) })
  }
  function details() {
    const pos = getPos()
    if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
    setDescription(node.attrs.alt ?? '')
    setCaption(node.attrs.title ?? '')
    setError('')
    setOpen(true)
  }
  async function replace(file: File) {
    const validation = validateImageUploadFile(file)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    setBusy(true)
    setError('')
    try {
      const compressed = await compressImage(file, 1200, 0.8)
      const result = await uploadFile(compressed, convex, 'article_image')
      if (!result.success || !result.url)
        throw new Error(result.error || 'Could not replace image.')
      updateAttributes({ src: result.url, width: null, height: null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not replace image.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <NodeViewWrapper
      className="writing-image"
      data-selected={selected}
      contentEditable={false}
    >
      <figure
        className="w-[attr(data-width_px,600px)] max-w-full"
        data-width={displayWidth}
      >
        <button
          type="button"
          ref={imageButton}
          className="writing-image-open"
          aria-label="Edit image details"
          onClick={details}
          disabled={!editor.isEditable}
        >
          {/* User-uploaded image URLs are displayed directly in the editor. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={image}
            src={node.attrs.src}
            alt={node.attrs.alt ?? ''}
            draggable={false}
          />
        </button>
        {node.attrs.title && <figcaption>{node.attrs.title}</figcaption>}
        {editor.isEditable && (
          <div className="writing-image-tools">
            <button
              type="button"
              aria-label="Resize image"
              title="Drag to resize. Arrow keys adjust width."
              className="writing-resize"
              onPointerDown={(e) => {
                e.preventDefault()
                e.currentTarget.setPointerCapture(e.pointerId)
                start.current = { x: e.clientX, width: displayWidth }
              }}
              onPointerMove={(e) => {
                if (start.current)
                  setDisplayWidth(
                    clamp(start.current.width + e.clientX - start.current.x)
                  )
              }}
              onPointerUp={(e) => {
                if (start.current) {
                  resize(displayWidth)
                  start.current = null
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              }}
              onPointerCancel={() => {
                start.current = null
                resize(displayWidth)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  resize(displayWidth + (e.key === 'ArrowRight' ? 10 : -10))
                }
              }}
            >
              ↔
            </button>
            <select
              aria-label="Image size"
              value=""
              onChange={(e) => {
                resize(
                  e.target.value === 'original'
                    ? image.current?.naturalWidth || 600
                    : Number(e.target.value)
                )
              }}
            >
              <option value="">Image size</option>
              <option value="300">Small</option>
              <option value="600">Medium</option>
              <option value="900">Large</option>
              <option value="original">Original</option>
            </select>
            <button onClick={details}>Image details</button>
          </div>
        )}
      </figure>
      <WritingDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Image details"
        appearance={getArticleAppearance(editor.getJSON())}
        busy={busy}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            updateAttributes({ alt: description, title: caption })
            setOpen(false)
          }}
        >
          <label htmlFor="image-description">Image description</label>
          <input
            id="image-description"
            maxLength={300}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
          <label htmlFor="image-caption">Caption (optional)</label>
          <input
            id="image-caption"
            maxLength={400}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={busy}
          />
          <div className="image-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              Replace
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                deleteNode()
              }}
            >
              Remove
            </button>
          </div>
          <input
            hidden
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const selected = e.target.files?.[0]
              if (selected) void replace(selected)
              e.target.value = ''
            }}
          />
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Replacing image…</p>}
          <button className="wine wide" disabled={busy}>
            Save image details
          </button>
        </form>
      </WritingDialog>
    </NodeViewWrapper>
  )
}
export const WritingImage = ResizableImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(WritingImageView)
  },
})
