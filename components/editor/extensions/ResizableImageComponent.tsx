'use client'

import { NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useCallback, useEffect, useRef } from 'react'

export default function ResizableImageComponent({
  node,
  updateAttributes,
  selected,
}: ReactNodeViewProps) {
  const { src, alt, title, width, height } = node.attrs
  const [isResizing, setIsResizing] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [originalSize, setOriginalSize] = useState({ width: 0, height: 0 })
  const [currentSize, setCurrentSize] = useState({
    width: width || 400,
    height: height || 300,
  })
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setCurrentSize({ width: width || 400, height: height || 300 })
  }, [width, height])

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.target as HTMLImageElement
      setOriginalSize({ width: img.naturalWidth, height: img.naturalHeight })

      if (!width && !height) {
        // Set initial size constraints
        const maxWidth = Math.min(img.naturalWidth, 600) // Max 600px width
        const aspectRatio = img.naturalHeight / img.naturalWidth
        const newHeight = Math.round(maxWidth * aspectRatio)

        setCurrentSize({ width: maxWidth, height: newHeight })
        updateAttributes({ width: maxWidth, height: newHeight })
      }
    },
    [width, height, updateAttributes]
  )

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return

      const deltaX = e.clientX - dragStart.x
      const currentWidth =
        typeof currentSize.width === 'number' ? currentSize.width : 400
      const newWidth = Math.max(100, Math.min(1200, currentWidth + deltaX)) // Min 100px, max 1200px

      // Maintain aspect ratio
      const aspectRatio = originalSize.height / originalSize.width
      const newHeight = newWidth * aspectRatio

      setCurrentSize({ width: newWidth, height: newHeight })
    },
    [isResizing, dragStart.x, currentSize.width, originalSize]
  )

  const handleMouseUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false)
      updateAttributes({
        width:
          typeof currentSize.width === 'number'
            ? Math.round(currentSize.width)
            : null,
        height:
          typeof currentSize.height === 'number'
            ? Math.round(currentSize.height)
            : null,
      })
    }
  }, [isResizing, currentSize, updateAttributes])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  const handleSizeChange = (
    newSize: 'small' | 'medium' | 'large' | 'original'
  ) => {
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

    const aspectRatio = originalSize.height / originalSize.width
    const newHeight = newWidth * aspectRatio

    setCurrentSize({ width: newWidth, height: newHeight })
    updateAttributes({ width: newWidth, height: newHeight })
  }

  return (
    <NodeViewWrapper className="resizable-image-wrapper">
      <div
        className={`relative inline-block group ${selected ? 'ring-2 ring-blue-500' : ''}`}
        style={{ maxWidth: '100%' }}
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
            {/* Resize Handle - mouse-only interaction for drag resizing */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 bg-primary border-2 border-background rounded cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity"
              onMouseDown={handleMouseDown}
              style={{ transform: 'translate(50%, 50%)' }}
            />

            {/* Size Controls */}
            <div className="absolute top-0 left-0 transform -translate-y-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex gap-1 bg-popover rounded-lg shadow-lg border border-border p-1">
                <button
                  onClick={() => handleSizeChange('small')}
                  className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded text-foreground"
                >
                  Small
                </button>
                <button
                  onClick={() => handleSizeChange('medium')}
                  className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded text-foreground"
                >
                  Medium
                </button>
                <button
                  onClick={() => handleSizeChange('large')}
                  className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded text-foreground"
                >
                  Large
                </button>
                <button
                  onClick={() => handleSizeChange('original')}
                  className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded text-foreground"
                >
                  Original
                </button>
              </div>
            </div>

            {/* Dimensions Display */}
            <div className="absolute bottom-0 left-0 transform translate-y-full mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="bg-black/75 text-white text-xs px-2 py-1 rounded">
                {Math.round(currentSize.width)} ×{' '}
                {Math.round(
                  currentSize.height *
                    (originalSize.height / originalSize.width)
                )}
                px
              </div>
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}
