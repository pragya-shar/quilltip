'use client'

import { NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { parseNumericAttr } from './ResizableImage'

const MIN_WIDTH = 100
const MAX_WIDTH = 1200
const KEYBOARD_RESIZE_STEP = 10

function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))
}

function sizeFromWidth(
  newWidth: number,
  naturalWidth: number,
  naturalHeight: number
): { width: number; height: number } {
  if (naturalWidth <= 0) {
    return { width: newWidth, height: newWidth }
  }
  const aspectRatio = naturalHeight / naturalWidth
  return { width: newWidth, height: Math.round(newWidth * aspectRatio) }
}

export default function ResizableImageComponent({
  node,
  updateAttributes,
  selected,
  editor,
}: ReactNodeViewProps) {
  const { src, alt, title } = node.attrs
  const width = parseNumericAttr(node.attrs.width)
  const height = parseNumericAttr(node.attrs.height)

  const [isResizing, setIsResizing] = useState(false)
  const [pointerStart, setPointerStart] = useState({ x: 0, width: 0 })
  const [originalSize, setOriginalSize] = useState({ width: 0, height: 0 })
  const [currentSize, setCurrentSize] = useState({
    width: width ?? 400,
    height: height ?? 300,
  })
  const [altDraft, setAltDraft] = useState(alt ?? '')
  const imageRef = useRef<HTMLImageElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setCurrentSize({
      width: width ?? 400,
      height: height ?? 300,
    })
  }, [width, height])

  useEffect(() => {
    setAltDraft(alt ?? '')
  }, [alt])

  useEffect(() => {
    if (!selected || !editor.storage.resizableImage.shouldFocus) return
    wrapperRef.current?.focus()
    editor.storage.resizableImage.shouldFocus = false
  }, [selected, editor])

  const commitSize = useCallback(
    (size: { width: number; height: number }) => {
      updateAttributes({
        width: Math.round(size.width),
        height: Math.round(size.height),
      })
    },
    [updateAttributes]
  )

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.target as HTMLImageElement
      setOriginalSize({ width: img.naturalWidth, height: img.naturalHeight })

      if (width == null && height == null) {
        const maxWidth = Math.min(img.naturalWidth, 600)
        const next = sizeFromWidth(
          maxWidth,
          img.naturalWidth,
          img.naturalHeight
        )
        setCurrentSize(next)
        commitSize(next)
      }
    },
    [width, height, commitSize]
  )

  const applyWidthDelta = useCallback(
    (deltaX: number, baseWidth?: number) => {
      const base =
        baseWidth ??
        (typeof currentSize.width === 'number' ? currentSize.width : 400)
      const newWidth = clampWidth(base + deltaX)
      const next = sizeFromWidth(
        newWidth,
        originalSize.width,
        originalSize.height
      )
      setCurrentSize(next)
      return next
    },
    [currentSize.width, originalSize]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const handle = resizeHandleRef.current
      if (!handle) return
      handle.setPointerCapture(e.pointerId)
      setIsResizing(true)
      setPointerStart({
        x: e.clientX,
        width:
          typeof currentSize.width === 'number' ? currentSize.width : 400,
      })
    },
    [currentSize.width]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isResizing) return
      const deltaX = e.clientX - pointerStart.x
      applyWidthDelta(deltaX, pointerStart.width)
    },
    [isResizing, pointerStart, applyWidthDelta]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isResizing) return
      const handle = resizeHandleRef.current
      if (handle?.hasPointerCapture(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId)
      }
      setIsResizing(false)
      commitSize(currentSize)
    },
    [isResizing, currentSize, commitSize]
  )

  const handleKeyboardResize = useCallback(
    (direction: 'decrease' | 'increase') => {
      const delta = direction === 'increase' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP
      const next = applyWidthDelta(delta)
      commitSize(next)
    },
    [applyWidthDelta, commitSize]
  )

  const handleWrapperKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleKeyboardResize('decrease')
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleKeyboardResize('increase')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        editor.commands.focus()
      }
    },
    [handleKeyboardResize, editor]
  )

  const handleSizeChange = (
    newSize: 'small' | 'medium' | 'large' | 'original'
  ) => {
    if (originalSize.width <= 0) return

    let newWidth: number
    switch (newSize) {
      case 'small':
        newWidth = Math.min(300, originalSize.width)
        break
      case 'medium':
        newWidth = Math.min(600, originalSize.width)
        break
      case 'large':
        newWidth = Math.min(900, originalSize.width)
        break
      case 'original':
        newWidth = originalSize.width
        break
      default:
        return
    }

    const next = sizeFromWidth(
      newWidth,
      originalSize.width,
      originalSize.height
    )
    setCurrentSize(next)
    commitSize(next)
  }

  const handleAltBlur = () => {
    const trimmed = altDraft.trim()
    updateAttributes({ alt: trimmed || null })
  }

  const displayHeight =
    originalSize.width > 0
      ? Math.round(
          (typeof currentSize.width === 'number' ? currentSize.width : 400) *
            (originalSize.height / originalSize.width)
        )
      : Math.round(
          typeof currentSize.height === 'number' ? currentSize.height : 300
        )

  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

  return (
    <NodeViewWrapper className="resizable-image-wrapper">
      <div
        ref={wrapperRef}
        role="group"
        tabIndex={selected ? 0 : -1}
        aria-label={
          selected
            ? 'Selected image. Use arrow keys to resize, or Tab to size presets and description.'
            : 'Image'
        }
        onKeyDown={selected ? handleWrapperKeyDown : undefined}
        className={`relative inline-block max-w-full ${selected ? 'ring-2 ring-blue-500 rounded-lg' : ''}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={alt || 'Uploaded image'}
          title={title || ''}
          onLoad={handleImageLoad}
          style={{
            width: `${currentSize.width}px`,
            height: 'auto',
            maxWidth: '100%',
            display: 'block',
          }}
          className="rounded-lg"
          draggable={false}
        />

        {selected && (
          <>
            <button
              ref={resizeHandleRef}
              type="button"
              aria-label="Resize image. Drag or use arrow keys when focused on the image."
              className={`absolute bottom-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded cursor-nw-resize bg-primary border-2 border-background opacity-100 touch-manipulation ${focusRing}`}
              style={{ transform: 'translate(50%, 50%)' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault()
                  handleKeyboardResize('decrease')
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault()
                  handleKeyboardResize('increase')
                }
              }}
            >
              <span
                className="block h-3 w-3 rounded-sm bg-background"
                aria-hidden
              />
            </button>

            <div
              className="absolute top-0 left-0 mb-2 max-w-[min(100vw,28rem)] -translate-y-full opacity-100"
              role="presentation"
            >
              <div
                role="toolbar"
                aria-label="Image size"
                className="flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
              >
                <button
                  type="button"
                  aria-label="Resize image to small"
                  onClick={() => handleSizeChange('small')}
                  className={`rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/80 ${focusRing}`}
                >
                  Small
                </button>
                <button
                  type="button"
                  aria-label="Resize image to medium"
                  onClick={() => handleSizeChange('medium')}
                  className={`rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/80 ${focusRing}`}
                >
                  Medium
                </button>
                <button
                  type="button"
                  aria-label="Resize image to large"
                  onClick={() => handleSizeChange('large')}
                  className={`rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/80 ${focusRing}`}
                >
                  Large
                </button>
                <button
                  type="button"
                  aria-label="Resize image to original size"
                  onClick={() => handleSizeChange('original')}
                  className={`rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/80 ${focusRing}`}
                >
                  Original
                </button>
                <input
                  type="text"
                  value={altDraft}
                  onChange={(e) => setAltDraft(e.target.value)}
                  onBlur={handleAltBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAltBlur()
                      editor.commands.focus()
                    }
                  }}
                  placeholder="Description"
                  aria-label="Image description"
                  className={`min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs text-foreground ${focusRing}`}
                />
              </div>
            </div>

            <div
              className="absolute bottom-0 left-0 mt-1 translate-y-full opacity-100"
              aria-live="polite"
            >
              <div className="rounded bg-black/75 px-2 py-1 text-xs text-white">
                {Math.round(
                  typeof currentSize.width === 'number' ? currentSize.width : 0
                )}{' '}
                × {displayHeight}px
              </div>
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}
