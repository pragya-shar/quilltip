'use client'

import { useState, useRef } from 'react'
import { Upload, Link2, Image as ImageIcon } from 'lucide-react'
import { uploadFile, compressImage } from '@/lib/upload'
import { useConvex } from 'convex/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ImageUploadDialogProps {
  onImageSelect: (url: string) => void
  onClose: () => void
  isOpen: boolean
  title?: string
}

export function ImageUploadDialog({
  onImageSelect,
  onClose,
  isOpen,
  title = 'Add Image',
}: ImageUploadDialogProps) {
  const [uploadMethod, setUploadMethod] = useState<'file' | 'url'>('file')
  const [imageUrl, setImageUrl] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const convex = useConvex()

  const handleFileSelect = async (file: File) => {
    setError('')
    setIsUploading(true)
    setUploadProgress(0)

    try {
      const compressedFile = await compressImage(file, 1200, 0.8)
      const result = await uploadFile(
        compressedFile,
        convex,
        'article_image',
        undefined,
        (progress) => {
          setUploadProgress(progress.percentage)
        }
      )

      if (result.success && result.url) {
        onImageSelect(result.url)
        onClose()
        resetState()
      } else {
        setError(result.error || 'Upload failed')
      }
    } catch (error) {
      setError('Upload failed. Please try again.')
      console.error('Upload error:', error)
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)

    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file)
    } else {
      setError('Please drop an image file')
    }
  }

  const handleUrlSubmit = async () => {
    if (!imageUrl.trim()) return

    setError('')
    setIsUploading(true)
    setUploadProgress(0)

    try {
      setUploadProgress(20)
      const response = await fetch(imageUrl)

      if (!response.ok) {
        throw new Error('Failed to fetch image from URL')
      }

      const blob = await response.blob()
      setUploadProgress(40)

      if (!blob.type.startsWith('image/')) {
        throw new Error('URL does not point to a valid image')
      }

      const file = new File([blob], 'image-from-url', { type: blob.type })
      setUploadProgress(60)

      const compressedFile = await compressImage(file, 1200, 0.8)
      setUploadProgress(80)

      const result = await uploadFile(
        compressedFile,
        convex,
        'article_image',
        undefined,
        (progress) => {
          setUploadProgress(80 + Math.floor(progress.percentage * 0.2))
        }
      )

      if (result.success && result.url) {
        onImageSelect(result.url)
        onClose()
        resetState()
      } else {
        setError(result.error || 'Upload failed')
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          setError(
            'Unable to fetch image from URL. The image may be protected by CORS policy.'
          )
        } else {
          setError(error.message)
        }
      } else {
        setError('Failed to process image from URL')
      }
      console.error('URL image upload error:', error)
    } finally {
      setIsUploading(false)
    }
  }

  const resetState = () => {
    setImageUrl('')
    setIsUploading(false)
    setUploadProgress(0)
    setError('')
    setUploadMethod('file')
  }

  const handleClose = () => {
    onClose()
    resetState()
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      <DialogContent
        className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md"
        onInteractOutside={(e) => {
          if (isUploading) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isUploading) e.preventDefault()
        }}
      >
        <DialogHeader className="border-b border-border p-4 text-left">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="p-4">
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setUploadMethod('file')}
              className={`flex-1 rounded-lg py-2 px-3 text-sm font-medium transition-colors ${
                uploadMethod === 'file'
                  ? 'border border-border bg-primary/15 text-primary'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              <Upload className="mr-2 inline h-4 w-4" />
              Upload File
            </button>
            <button
              type="button"
              onClick={() => setUploadMethod('url')}
              className={`flex-1 rounded-lg py-2 px-3 text-sm font-medium transition-colors ${
                uploadMethod === 'url'
                  ? 'border border-border bg-primary/15 text-primary'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              <Link2 className="mr-2 inline h-4 w-4" />
              URL
            </button>
          </div>

          {uploadMethod === 'file' && (
            <div>
              <div
                className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                  dragActive
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/40'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isUploading ? (
                  <div className="space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
                      <Upload className="h-6 w-6 animate-pulse text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Optimizing and uploading...
                      </p>
                      <div className="mt-2">
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {uploadProgress}%
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Drag and drop an image, or{' '}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-primary hover:text-primary/80"
                        >
                          browse
                        </button>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        PNG, JPG, GIF up to 10MB
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}

          {uploadMethod === 'url' && (
            <div className="space-y-3">
              {isUploading ? (
                <div className="space-y-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
                    <Upload className="h-6 w-6 animate-pulse text-primary" />
                  </div>
                  <div>
                    <p className="text-center text-sm text-muted-foreground">
                      Processing image from URL...
                    </p>
                    <div className="mt-2">
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-center text-xs text-muted-foreground">
                        {uploadProgress}%
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    type="url"
                    placeholder="https://example.com/image.jpg"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isUploading) {
                        void handleUrlSubmit()
                      }
                    }}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void handleUrlSubmit()}
                    disabled={!imageUrl.trim() || isUploading}
                    className="w-full rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Upload Image
                  </button>
                  <p className="text-center text-xs text-muted-foreground">
                    External images will be downloaded and stored in Convex
                  </p>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
