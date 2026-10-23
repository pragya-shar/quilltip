import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { readImage } from './lib/imageUpload'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Token',
  'Cache-Control': 'no-store',
}

export const options = httpAction(
  async () => new Response(null, { status: 204, headers })
)
export const upload = httpAction(async (ctx, request) => {
  // This one-use capability authenticates the request; cookies are never accepted.
  const token = request.headers.get('X-Upload-Token') ?? ''
  if (!/^[a-f0-9]{64}$/.test(token))
    return new Response('Invalid upload ticket', { status: 401, headers })
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(new TextEncoder().encode(token))
  )
  const tokenHash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  const userId = await ctx.runMutation(internal.uploadTickets.consume, {
    tokenHash,
  })
  if (!userId)
    return new Response('Invalid or expired upload ticket', {
      status: 401,
      headers,
    })
  let blob: Blob
  try {
    blob = await readImage(request)
  } catch {
    return new Response(
      'Upload must be a PNG, JPEG, GIF or WebP image up to 10MB',
      { status: 400, headers }
    )
  }
  const storageId = await ctx.storage.store(blob)
  try {
    await ctx.runMutation(internal.uploadTickets.recordOwner, {
      storageId,
      userId,
      fileType: blob.type,
    })
  } catch (error) {
    await ctx.storage.delete(storageId)
    throw error
  }
  return Response.json({ storageId }, { headers })
})
