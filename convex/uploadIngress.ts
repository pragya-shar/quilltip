'use node'

import { randomBytes, createHash } from 'node:crypto'
import { getAuthUserId } from '@convex-dev/auth/server'
import { action } from './_generated/server'
import { internal } from './_generated/api'

export const issueTicket = action({
  args: {},
  handler: async (ctx): Promise<{ url: string; token: string }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const siteUrl = process.env.CONVEX_SITE_URL
    if (!siteUrl) throw new Error('Upload endpoint is not configured')
    const token = randomBytes(32).toString('hex')
    await ctx.runMutation(internal.uploadTickets.create, {
      userId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
    })
    return { url: `${siteUrl}/image-upload`, token }
  },
})
