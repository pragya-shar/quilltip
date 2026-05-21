/**
 * File upload utilities for handling image uploads to Convex Storage
 */

import { ConvexReactClient } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export const IMAGE_UPLOAD_FORMAT_HINT =
  'PNG, JPG, GIF, or WEBP up to 10MB'

export function isValidImageSourceUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export type ImageUploadValidationResult =
  | { ok: true }
  | { ok: false; error: string }

export function validateImageUploadFile(
  file: File
): ImageUploadValidationResult {
  if (!file.type || !ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: 'Unsupported image type. Use PNG, JPG, GIF, or WEBP.',
    }
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      ok: false,
      error: 'Image must be 10MB or smaller',
    }
  }

  return { ok: true }
}

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

const COMPRESS_IMAGE_TIMEOUT_MS = 30_000

function makeAbortError(message = 'Upload canceled'): DOMException {
  return new DOMException(message, 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Upload a file using Convex storage and get back the public URL.
 *
 * Throws a `DOMException('AbortError')` when the provided signal is aborted,
 * so callers can distinguish cancellation from real failures.
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
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal
): Promise<UploadResult> {
  if (signal?.aborted) {
    throw makeAbortError()
  }

  try {
    const validation = validateImageUploadFile(file)
    if (!validation.ok) {
      return { success: false, error: validation.error }
    }

    const uploadUrl = await convexClient.mutation(
      api.uploads.generateUploadUrl,
      {}
    )

    if (signal?.aborted) {
      throw makeAbortError()
    }

    const result = await new Promise<{
      storageId?: Id<'_storage'>
      error?: string
      aborted?: boolean
    }>((resolve) => {
      const xhr = new XMLHttpRequest()

      const onAbort = () => xhr.abort()
      signal?.addEventListener('abort', onAbort)
      const detach = () => signal?.removeEventListener('abort', onAbort)

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

      xhr.addEventListener('load', () => {
        detach()
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

      xhr.addEventListener('error', () => {
        detach()
        resolve({ error: 'Network error occurred during upload' })
      })

      xhr.addEventListener('abort', () => {
        detach()
        resolve({ aborted: true })
      })

      xhr.open('POST', uploadUrl)
      xhr.send(file)
    })

    if (result.aborted) {
      throw makeAbortError()
    }

    if (result.error || !result.storageId) {
      return {
        success: false,
        error: result.error || 'Upload failed',
      }
    }

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
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
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
 * Upload an image to Convex storage and set it as the signed-in user's avatar.
 */
export async function uploadAvatarFile(
  file: File,
  convexClient: ConvexReactClient,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const validation = validateImageUploadFile(file)
  if (!validation.ok) {
    return { success: false, error: validation.error }
  }

  try {
    const uploadUrl = await convexClient.mutation(
      api.uploads.generateUploadUrl,
      {}
    )

    const result = await new Promise<{
      storageId?: Id<'_storage'>
      error?: string
    }>((resolve) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          })
        }
      })

      xhr.addEventListener('load', () => {
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

      xhr.addEventListener('error', () => {
        resolve({ error: 'Network error occurred during upload' })
      })

      xhr.open('POST', uploadUrl)
      xhr.send(file)
    })

    if (result.error || !result.storageId) {
      return {
        success: false,
        error: result.error || 'Upload failed',
      }
    }

    const { avatarUrl } = await convexClient.mutation(
      api.uploads.updateUserAvatar,
      {
        storageId: result.storageId,
        fileName: file.name,
      }
    )

    return {
      success: true,
      url: avatarUrl ?? undefined,
    }
  } catch (error) {
    console.error('Avatar upload error:', error)
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
 * Compress image before upload (basic client-side compression).
 *
 * Rejects on decode failure, abort, or a 30s timeout so callers never hang.
 */
export function compressImage(
  file: File,
  maxWidth: number = 1200,
  quality: number = 0.8,
  signal?: AbortSignal
): Promise<File> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError())
      return
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Failed to get 2D canvas context'))
      return
    }

    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    let settled = false

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      URL.revokeObjectURL(objectUrl)
      img.onload = null
      img.onerror = null
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const onAbort = () => settle(() => reject(makeAbortError()))

    const timeoutId = window.setTimeout(() => {
      settle(() =>
        reject(new Error('Image compression timed out. Try a smaller image.'))
      )
    }, COMPRESS_IMAGE_TIMEOUT_MS)

    signal?.addEventListener('abort', onAbort)

    img.onload = () => {
      let { width, height } = img
      if (width > maxWidth) {
        height = (height * maxWidth) / width
        width = maxWidth
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            })
            settle(() => resolve(compressedFile))
          } else {
            settle(() => resolve(file))
          }
        },
        file.type,
        quality
      )
    }

    img.onerror = () => {
      settle(() =>
        reject(
          new Error(
            'Could not read image. The file may be corrupt or unsupported.'
          )
        )
      )
    }

    img.src = objectUrl
  })
}
