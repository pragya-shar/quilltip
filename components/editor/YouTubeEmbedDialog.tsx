'use client'

import { useState } from 'react'
import { Youtube, Link2, Play } from 'lucide-react'
import Image from 'next/image'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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

  const isValidYouTubeUrl = (url: string): boolean => {
    return extractYouTubeId(url) !== null
  }

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
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border p-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 shrink-0 text-red-600" />
            Embed YouTube Video
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <label
              htmlFor="youtube-url"
              className="block text-sm font-medium text-foreground"
            >
              YouTube URL
            </label>
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
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
                className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-3 text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Supports youtube.com and youtu.be URLs
            </p>
          </div>

          {previewUrl && !imageError && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">
                Preview
              </span>
              <div className="relative overflow-hidden rounded-lg bg-muted">
                <Image
                  src={previewUrl}
                  alt="Video preview"
                  width={400}
                  height={128}
                  className="h-32 w-full object-cover"
                  onError={() => setImageError(true)}
                  unoptimized
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600">
                    <Play className="ml-1 h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {previewUrl && imageError && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">
                Preview
              </span>
              <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-lg bg-muted">
                <div className="text-center">
                  <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-red-600">
                    <Youtube className="h-6 w-6 text-white" />
                  </div>
                  <p className="text-sm text-muted-foreground">YouTube Video</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="customDimensions"
                checked={customDimensions}
                onChange={(e) => setCustomDimensions(e.target.checked)}
                className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-ring"
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
                    className="mb-1 block text-sm font-medium text-foreground"
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
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label
                    htmlFor="youtube-height"
                    className="mb-1 block text-sm font-medium text-foreground"
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
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-ring"
                  />
                </div>
              </div>
            )}

            {!customDimensions && (
              <p className="text-xs text-muted-foreground">
                Default size: 640 x 480 pixels
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-lg bg-muted px-4 py-2 text-foreground transition-colors hover:bg-muted/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!videoUrl.trim()}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Embed Video
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
