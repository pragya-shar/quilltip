import type { DatabaseReader } from '../_generated/server'
import { Id } from '../_generated/dataModel'

interface UserDoc {
  _id: Id<'users'>
  name?: string
  username: string
  avatar?: string
}

export interface PublicUser {
  id: Id<'users'>
  name?: string
  username: string
  avatar?: string
}

/**
 * Look up a user by ID and return the public user shape.
 * Returns null if user not found.
 */
export async function enrichWithUser(
  ctx: { db: DatabaseReader },
  userId: Id<'users'> | undefined
): Promise<PublicUser | null> {
  if (!userId) return null
  const user = (await ctx.db.get(userId)) as UserDoc | null
  if (!user) return null
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
  }
}
