'use client'

import { useState } from 'react'
import { X, Youtube, Link2, Play } from 'lucide-react'
import Image from 'next/image'

interface YouTubeEmbedDialogProps {
  onVideoEmbed: (url: string, width?: number, height?: number) => void
  onClose: () => void
  isOpen: boolean
}

export function YouTubeEmbedDialog({
  onVideoEmbed,
  onClose,
  isOpen,
}: YouTubeEmbedDialogProps) {
  const [videoUrl, setVideoUrl] = useState('')
  const [customDimensions, setCustomDimensions] = useState(false)
  const [width, setWidth] = useState(640)
  const [height, setHeight] = useState(480)
  const [error, setError] = useState('')
  const [imageError, setImageError] = useState(false)

  if (!isOpen) return null

  // Extract YouTube video ID from various URL formats
  const extractYouTubeId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match && match[1]) {
        return match[1]
      }
    }
    return null
  }

  // Validate YouTube URL
  const isValidYouTubeUrl = (url: string): boolean => {
    return extractYouTubeId(url) !== null
  }

  // Generate preview URL
  const getPreviewUrl = (url: string): string | null => {
    const videoId = extractYouTubeId(url)
    if (!videoId) return null
    return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
  }

  const handleSubmit = () => {
    setError('')

    if (!videoUrl.trim()) {
      setError('Please enter a YouTube URL')
      return
    }

    if (!isValidYouTubeUrl(videoUrl)) {
      setError('Please enter a valid YouTube URL')
      return
    }

    // Call the callback with the URL and optional dimensions
    onVideoEmbed(
      videoUrl.trim(),
      customDimensions ? width : undefined,
      customDimensions ? height : undefined
    )

    handleClose()
  }

  const resetState = () => {
    setVideoUrl('')
    setCustomDimensions(false)
    setWidth(640)
    setHeight(480)
    setError('')
    setImageError(false)
  }

  const handleClose = () => {
    onClose()
    resetState()
  }

  const previewUrl = videoUrl ? getPreviewUrl(videoUrl) : null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-popover text-popover-foreground rounded-lg shadow-xl w-full max-w-md mx-4 border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Youtube className="w-5 h-5 text-red-600" />
            <h3 className="text-lg font-semibold">Embed YouTube Video</h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-muted rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* URL Input */}
          <div className="space-y-2">
            <label
              htmlFor="youtube-url"
              className="block text-sm font-medium text-foreground"
            >
              YouTube URL
            </label>
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                id="youtube-url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSubmit()
                  }
                }}
                className="w-full pl-10 pr-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Supports youtube.com and youtu.be URLs
            </p>
          </div>

          {/* Preview */}
          {previewUrl && !imageError && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">
                Preview
              </span>
              <div className="relative bg-muted rounded-lg overflow-hidden">
                <Image
                  src={previewUrl}
                  alt="Video preview"
                  width={400}
                  height={128}
                  className="w-full h-32 object-cover"
                  onError={() => setImageError(true)}
                  unoptimized
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center">
                    <Play className="w-6 h-6 text-white ml-1" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Fallback preview for when image fails to load */}
          {previewUrl && imageError && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">
                Preview
              </span>
              <div className="relative bg-muted rounded-lg overflow-hidden h-32 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Youtube className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-sm text-muted-foreground">YouTube Video</p>
                </div>
              </div>
            </div>
          )}

          {/* Custom Dimensions */}
          <div className="space-y-3">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="customDimensions"
                checked={customDimensions}
                onChange={(e) => setCustomDimensions(e.target.checked)}
                className="w-4 h-4 text-primary border-input bg-background rounded focus:ring-ring"
              />
              <label
                htmlFor="customDimensions"
                className="ml-2 text-sm font-medium text-foreground"
              >
                Custom dimensions
              </label>
            </div>

            {customDimensions && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="youtube-width"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Width (px)
                  </label>
                  <input
                    id="youtube-width"
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    min="100"
                    max="1920"
                    className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label
                    htmlFor="youtube-height"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Height (px)
                  </label>
                  <input
                    id="youtube-height"
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    min="100"
                    max="1080"
                    className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            )}

            {!customDimensions && (
              <p className="text-xs text-muted-foreground">
                Default size: 640 × 480 pixels
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!videoUrl.trim()}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Embed Video
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
