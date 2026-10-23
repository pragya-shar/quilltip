import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'

import type { Id } from './_generated/dataModel'
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './lib/imageUpload'
import {
  syncArticleUploadReferences,
  syncAvatarUploadReference,
} from './lib/uploadReferences'

async function requireOwnedImage(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  userId: Id<'users'>
) {
  const owner = await ctx.db
    .query('uploadOwners')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .unique()
  if (!owner || owner.userId !== userId)
    throw new Error(
      'Upload ownership could not be verified; please upload the image again'
    )
  const metadata = await ctx.db.system.get(storageId)
  if (
    !metadata ||
    !IMAGE_TYPES.includes(owner.fileType) ||
    metadata.size > MAX_IMAGE_BYTES
  )
    throw new Error('Invalid stored image')
  return { owner, fileType: owner.fileType, fileSize: metadata.size }
}

// Retire the unbound upload path; old clients must refresh.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    throw new Error('Please refresh the page to use secure uploads')
  },
})

// Store file metadata after upload
export const storeFileMetadata = mutation({
  args: {
    storageId: v.id('_storage'),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    uploadType: v.union(
      v.literal('avatar'),
      v.literal('article_image'),
      v.literal('cover_image'),
      v.literal('article_cover')
    ),
    articleId: v.optional(v.id('articles')),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const image = await requireOwnedImage(ctx, args.storageId, userId)
    if (args.articleId) {
      const article = await ctx.db.get(args.articleId)
      if (!article || article.authorId !== userId)
        throw new Error('Not authorized')
    }

    const now = Date.now()

    // Store file metadata
    const fileId = await ctx.db.insert('fileUploads', {
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: image.fileType,
      fileSize: image.fileSize,
      uploadType: args.uploadType,
      uploadedBy: userId,
      articleId: args.articleId,
      createdAt: now,
    })

    // Get the public URL for the file
    const url = await ctx.storage.getUrl(args.storageId)

    return {
      fileId,
      url,
    }
  },
})

// Get file URL by storage ID
export const getFileUrl = query({
  args: {
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId)
    return url
  },
})

// Get user's uploaded files
export const getUserUploads = query({
  args: {
    uploadType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const uploadsQuery = ctx.db
      .query('fileUploads')
      .withIndex('by_user', (q) => q.eq('uploadedBy', userId))

    const uploads = await uploadsQuery.collect()

    // Filter by upload type if specified
    const filteredUploads = args.uploadType
      ? uploads.filter((u) => u.uploadType === args.uploadType)
      : uploads

    // Get URLs for all files
    const uploadsWithUrls = await Promise.all(
      filteredUploads.map(async (upload) => {
        const url = await ctx.storage.getUrl(upload.storageId)
        return {
          ...upload,
          url,
        }
      })
    )

    return uploadsWithUrls
  },
})

// Delete file
export const deleteFile = mutation({
  args: {
    fileId: v.id('fileUploads'),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const file = await ctx.db.get(args.fileId)
    if (!file) throw new Error('File not found')
    if (file.uploadedBy !== userId) throw new Error('Not authorized')

    const image = await requireOwnedImage(ctx, file.storageId, userId)
    // Existing ownership rows predate complete saved-reference tracking.
    if (!image.owner.referencesTracked) {
      throw new Error(
        'Upload references could not be verified; please upload the image again'
      )
    }
    await ctx.db.delete(args.fileId)
    const remainingReference = await ctx.db
      .query('fileUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', file.storageId))
      .first()
    if (!remainingReference) {
      const activeReference = await ctx.db
        .query('uploadReferences')
        .withIndex('by_storage', (q) => q.eq('storageId', file.storageId))
        .first()
      if (activeReference) throw new Error('File is still in use')
      await ctx.storage.delete(file.storageId)
      await ctx.db.delete(image.owner._id)
    }

    return { success: true }
  },
})

// Update user avatar
export const updateUserAvatar = mutation({
  args: {
    storageId: v.id('_storage'),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const image = await requireOwnedImage(ctx, args.storageId, userId)

    // Get the public URL for the avatar
    const avatarUrl = await ctx.storage.getUrl(args.storageId)
    await syncAvatarUploadReference(
      ctx,
      userId,
      user.avatar,
      avatarUrl ?? undefined
    )

    // Store file metadata
    const now = Date.now()
    await ctx.db.insert('fileUploads', {
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: image.fileType,
      fileSize: image.fileSize,
      uploadType: 'avatar',
      uploadedBy: userId,
      createdAt: now,
    })

    // Update user profile
    await ctx.db.patch(userId, {
      avatar: avatarUrl || undefined,
      updatedAt: now,
    })

    return {
      avatarUrl,
    }
  },
})

// Update article cover image
export const updateArticleCoverImage = mutation({
  args: {
    articleId: v.id('articles'),
    storageId: v.id('_storage'),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const article = await ctx.db.get(args.articleId)
    if (!article) throw new Error('Article not found')
    if (article.authorId !== userId) throw new Error('Not authorized')

    const image = await requireOwnedImage(ctx, args.storageId, userId)

    // Get the public URL for the image
    const imageUrl = await ctx.storage.getUrl(args.storageId)
    await syncArticleUploadReferences(ctx, args.articleId, article, {
      ...article,
      coverImage: imageUrl ?? undefined,
    })

    // Store file metadata
    const now = Date.now()
    await ctx.db.insert('fileUploads', {
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: image.fileType,
      fileSize: image.fileSize,
      uploadType: 'cover_image',
      uploadedBy: userId,
      articleId: args.articleId,
      createdAt: now,
    })

    // Update article
    await ctx.db.patch(args.articleId, {
      coverImage: imageUrl || undefined,
      updatedAt: now,
    })

    return {
      imageUrl,
    }
  },
})
