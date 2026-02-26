/**
 * File upload utilities for handling image uploads to Convex Storage
 */

import { ConvexReactClient } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'

interface UploadResult {
  success: boolean
  url?: string
  error?: string
}

interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

/**
 * Upload a file using Convex storage and get back the public URL
 */
export async function uploadFile(
  file: File,
  convexClient: ConvexReactClient,
  uploadType:
    | 'avatar'
    | 'article_image'
    | 'cover_image'
    | 'article_cover' = 'article_image',
  articleId?: Id<'articles'>,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  try {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      return {
        success: false,
        error: 'Please select an image file',
      }
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return {
        success: false,
        error: 'Image must be smaller than 10MB',
      }
    }

    // Step 1: Get upload URL from Convex
    const uploadUrl = await convexClient.mutation(
      api.uploads.generateUploadUrl,
      {}
    )

    // Step 2: Upload file to Convex storage with progress tracking
    const result = await new Promise<{
      storageId?: Id<'_storage'>
      error?: string
    }>((resolve) => {
      const xhr = new XMLHttpRequest()

      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          }
          onProgress(progress)
        }
      })

      // Handle completion
      xhr.addEventListener('load', async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            resolve({ storageId: response.storageId })
          } catch {
            resolve({ error: 'Failed to parse upload response' })
          }
        } else {
          resolve({ error: 'Failed to upload file to storage' })
        }
      })

      // Handle errors
      xhr.addEventListener('error', () => {
        resolve({ error: 'Network error occurred during upload' })
      })

      // Start upload
      xhr.open('POST', uploadUrl)
      xhr.send(file)
    })

    if (result.error || !result.storageId) {
      return {
        success: false,
        error: result.error || 'Upload failed',
      }
    }

    // Step 3: Store file metadata and get public URL
    const metadata = await convexClient.mutation(
      api.uploads.storeFileMetadata,
      {
        storageId: result.storageId,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadType,
        articleId,
      }
    )

    return {
      success: true,
      url: metadata.url || undefined,
    }
  } catch (error) {
    console.error('Upload error:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Network error occurred during upload',
    }
  }
}

/**
 * Generate a unique filename with timestamp
 */
export function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now()
  const randomString = Math.random().toString(36).substring(2, 15)
  const extension = originalName.split('.').pop()
  return `${timestamp}-${randomString}.${extension}`
}

/**
 * Compress image before upload (basic client-side compression)
 */
export function compressImage(
  file: File,
  maxWidth: number = 1200,
  quality: number = 0.8
): Promise<File> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const img = new Image()

    img.onload = () => {
      // Revoke object URL to prevent memory leak
      URL.revokeObjectURL(img.src)

      // Calculate new dimensions
      let { width, height } = img
      if (width > maxWidth) {
        height = (height * maxWidth) / width
        width = maxWidth
      }

      canvas.width = width
      canvas.height = height

      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            })
            resolve(compressedFile)
          } else {
            resolve(file) // Fallback to original
          }
        },
        file.type,
        quality
      )
    }

    img.src = URL.createObjectURL(file)
  })
}
