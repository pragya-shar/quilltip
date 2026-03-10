'use client'

import { useState, useRef } from 'react'
import { Upload, Link2, X, Image as ImageIcon } from 'lucide-react'
import { uploadFile, compressImage } from '@/lib/upload'
import { useConvex } from 'convex/react'

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

  // Get Convex client for uploads
  const convex = useConvex()

  if (!isOpen) return null

  const handleFileSelect = async (file: File) => {
    setError('')
    setIsUploading(true)
    setUploadProgress(0)

    try {
      // Compress image before upload for better performance
      const compressedFile = await compressImage(file, 1200, 0.8)
      const result = await uploadFile(
        compressedFile,
        convex,
        'article_image',
        undefined, // no specific article
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
      // Fetch the image from the URL
      setUploadProgress(20)
      const response = await fetch(imageUrl)

      if (!response.ok) {
        throw new Error('Failed to fetch image from URL')
      }

      const blob = await response.blob()
      setUploadProgress(40)

      // Check if it's actually an image
      if (!blob.type.startsWith('image/')) {
        throw new Error('URL does not point to a valid image')
      }

      // Convert blob to File
      const file = new File([blob], 'image-from-url', { type: blob.type })
      setUploadProgress(60)

      // Compress and upload to Convex storage
      const compressedFile = await compressImage(file, 1200, 0.8)
      setUploadProgress(80)

      const result = await uploadFile(
        compressedFile,
        convex,
        'article_image',
        undefined, // no specific article
        (progress) => {
          // Map the remaining progress from 80 to 100
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
        // Check for CORS errors
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Method Selection */}
        <div className="p-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setUploadMethod('file')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                uploadMethod === 'file'
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Upload className="w-4 h-4 inline mr-2" />
              Upload File
            </button>
            <button
              onClick={() => setUploadMethod('url')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                uploadMethod === 'url'
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Link2 className="w-4 h-4 inline mr-2" />
              URL
            </button>
          </div>

          {/* File Upload */}
          {uploadMethod === 'file' && (
            <div>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isUploading ? (
                  <div className="space-y-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6 text-blue-600 animate-pulse" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">
                        Optimizing and uploading...
                      </p>
                      <div className="mt-2">
                        <div className="bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {uploadProgress}%
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                      <ImageIcon className="w-6 h-6 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        Drag and drop an image, or{' '}
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          browse
                        </button>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
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

          {/* URL Input */}
          {uploadMethod === 'url' && (
            <div className="space-y-3">
              {isUploading ? (
                <div className="space-y-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6 text-blue-600 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 text-center">
                      Processing image from URL...
                    </p>
                    <div className="mt-2">
                      <div className="bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1 text-center">
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
                        handleUrlSubmit()
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <button
                    onClick={handleUrlSubmit}
                    disabled={!imageUrl.trim() || isUploading}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Upload Image
                  </button>
                  <p className="text-xs text-gray-500 text-center">
                    External images will be downloaded and stored in Convex
                  </p>
                </>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
