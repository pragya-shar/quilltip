'use client'

import { useState, useRef, useEffect, type RefObject } from 'react'
import { Upload, Link2, Image as ImageIcon } from 'lucide-react'
import {
  uploadFile,
  compressImage,
  validateImageUploadFile,
  isValidImageSourceUrl,
  IMAGE_UPLOAD_FORMAT_HINT,
} from '@/lib/upload'
import { useConvex } from 'convex/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const IMAGE_URL_INPUT_ID = 'image-url-input'
const IMAGE_URL_REQUIREMENTS_ID = 'image-url-requirements'
const IMAGE_URL_ERROR_ID = 'image-url-error'
const FILE_UPLOAD_ERROR_ID = 'file-upload-error'

interface ImageUploadDialogProps {
  onImageSelect: (url: string) => void
  onClose: () => void
  isOpen: boolean
  title?: string
  /** Element to restore focus after close when using controlled open without DialogTrigger */
  triggerRef?: RefObject<HTMLElement | null>
}

export function ImageUploadDialog({
  onImageSelect,
  onClose,
  isOpen,
  title = 'Add Image',
  triggerRef,
}: ImageUploadDialogProps) {
  const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
  const [uploadMethod, setUploadMethod] = useState<'file' | 'url'>('file')
  const [imageUrl, setImageUrl] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const [fileError, setFileError] = useState('')
  const [urlError, setUrlError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const convex = useConvex()
  const urlInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(isOpen)
  const isUploadingRef = useRef(isUploading)
  const handleCloseRef = useRef<() => void>(() => {})

  isUploadingRef.current = isUploading

  useEffect(() => {
    if (isOpen) setOpen(true)
  }, [isOpen])

  useEffect(() => {
    if (!open || uploadMethod !== 'url') return
    urlInputRef.current?.focus()
  }, [open, uploadMethod])

  const handleUploadMethodChange = (value: string) => {
    setUploadMethod(value as 'file' | 'url')
    setFileError('')
    setUrlError('')
  }

  const resetState = () => {
    setImageUrl('')
    setIsUploading(false)
    setUploadProgress(0)
    setFileError('')
    setUrlError('')
    setUploadMethod('file')
  }

  const handleClose = () => {
    setOpen(false)
    onClose()
    resetState()
  }

  handleCloseRef.current = handleClose

  // Radix only delivers Escape to the top dismissable layer; a higher invisible
  // layer (e.g. another dialog portal) can block it while outside click still works.
  useEffect(() => {
    if (!open) return

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isUploadingRef.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      handleCloseRef.current()
    }

    document.addEventListener('keydown', onDocumentKeyDown, { capture: true })
    return () =>
      document.removeEventListener('keydown', onDocumentKeyDown, {
        capture: true,
      })
  }, [open])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setOpen(true)
      return
    }
    handleClose()
  }

  if (!isOpen) {
    return null
  }

  const handleFileSelect = async (file: File) => {
    setFileError('')

    const validation = validateImageUploadFile(file)
    if (!validation.ok) {
      setFileError(validation.error)
      return
    }

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
        handleClose()
      } else {
        setFileError(result.error || 'Upload failed')
      }
    } catch (error) {
      setFileError('Upload failed. Please try again.')
      console.error('Upload error:', error)
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      void handleFileSelect(file)
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
    if (!file) {
      setFileError('Please drop an image file')
      return
    }

    void handleFileSelect(file)
  }

  const handleUrlSubmit = async () => {
    const trimmed = imageUrl.trim()
    if (!trimmed) {
      setUrlError('Enter an image URL')
      return
    }
    if (!isValidImageSourceUrl(trimmed)) {
      setUrlError('URL must start with http:// or https://')
      return
    }

    setUrlError('')
    setIsUploading(true)
    setUploadProgress(0)

    try {
      setUploadProgress(20)
      const response = await fetch(trimmed)

      if (!response.ok) {
        throw new Error('Failed to fetch image from URL')
      }

      const blob = await response.blob()
      setUploadProgress(40)

      const file = new File([blob], 'image-from-url', { type: blob.type })
      const validation = validateImageUploadFile(file)
      if (!validation.ok) {
        throw new Error(validation.error)
      }

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
        handleClose()
      } else {
        setUrlError(result.error || 'Upload failed')
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          setUrlError(
            'Unable to fetch image from URL. The image may be protected by CORS policy.'
          )
        } else {
          setUrlError(error.message)
        }
      } else {
        setUrlError('Failed to process image from URL')
      }
      console.error('URL image upload error:', error)
    } finally {
      setIsUploading(false)
    }
  }

  const urlDescribedBy = urlError
    ? `${IMAGE_URL_REQUIREMENTS_ID} ${IMAGE_URL_ERROR_ID}`
    : IMAGE_URL_REQUIREMENTS_ID

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md p-0 gap-0 overflow-hidden"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault()
            triggerRef.current.focus()
          }
        }}
        onEscapeKeyDown={(e) => {
          if (isUploading) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (isUploading) e.preventDefault()
        }}
      >
        <DialogHeader className="p-4 border-b border-border space-y-1 text-left pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Upload a file or paste an image URL to insert into your article.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4">
          <Tabs
            value={uploadMethod}
            onValueChange={handleUploadMethodChange}
            className="w-full"
          >
            <TabsList
              className="grid w-full grid-cols-2 mb-4 h-auto p-1"
              aria-label="Image upload method"
            >
              <TabsTrigger value="file" className="gap-2 py-2">
                <Upload className="w-4 h-4" />
                Upload File
              </TabsTrigger>
              <TabsTrigger value="url" className="gap-2 py-2">
                <Link2 className="w-4 h-4" />
                URL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="mt-0">
              <div
                className={cn(
                  'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                  dragActive
                    ? 'border-primary bg-primary/15'
                    : 'border-border hover:border-muted-foreground/40',
                  fileError && 'border-destructive'
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                aria-describedby={fileError ? FILE_UPLOAD_ERROR_ID : undefined}
              >
                {isUploading && uploadMethod === 'file' ? (
                  <div className="space-y-3" role="status" aria-live="polite">
                    <div className="w-12 h-12 bg-primary/15 rounded-full flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6 text-primary animate-pulse" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Optimizing and uploading...
                      </p>
                      <div className="mt-2">
                        <div className="bg-muted rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {uploadProgress}%
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto">
                      <ImageIcon className="w-6 h-6 text-muted-foreground" />
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
                      <p className="text-xs text-muted-foreground mt-1">
                        {IMAGE_UPLOAD_FORMAT_HINT}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {fileError ? (
                <p
                  id={FILE_UPLOAD_ERROR_ID}
                  role="alert"
                  className="text-xs text-destructive mt-2"
                >
                  {fileError}
                </p>
              ) : null}

              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                onChange={handleFileChange}
                className="hidden"
              />
            </TabsContent>

            <TabsContent value="url" className="mt-0">
              {isUploading ? (
                <div className="space-y-3" role="status" aria-live="polite">
                  <div className="w-12 h-12 bg-primary/15 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6 text-primary animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground text-center">
                      Processing image from URL...
                    </p>
                    <div className="mt-2">
                      <div className="bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 text-center">
                        {uploadProgress}%
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={IMAGE_URL_INPUT_ID}>Image URL</Label>
                    <Input
                      ref={urlInputRef}
                      id={IMAGE_URL_INPUT_ID}
                      type="url"
                      placeholder="https://example.com/image.jpg"
                      value={imageUrl}
                      onChange={(e) => {
                        setImageUrl(e.target.value)
                        if (urlError) setUrlError('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isUploading) {
                          void handleUrlSubmit()
                        }
                      }}
                      aria-invalid={!!urlError}
                      aria-describedby={urlDescribedBy}
                      aria-busy={isUploading}
                      className={cn(
                        urlError &&
                          'border-destructive focus-visible:ring-destructive'
                      )}
                    />
                    <p
                      id={IMAGE_URL_REQUIREMENTS_ID}
                      className="text-xs text-muted-foreground"
                    >
                      Must be http:// or https://. Image will be downloaded;
                      supported types: {IMAGE_UPLOAD_FORMAT_HINT}.
                    </p>
                    {urlError ? (
                      <p
                        id={IMAGE_URL_ERROR_ID}
                        role="alert"
                        className="text-xs text-destructive"
                      >
                        {urlError}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleUrlSubmit()}
                    disabled={isUploading}
                    className="w-full bg-primary text-primary-foreground py-2 px-4 rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Upload Image
                  </button>
                  <p className="text-xs text-muted-foreground text-center">
                    External images will be downloaded and stored in Convex
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
