import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'

export function useCurrentUser() {
  return useQuery(api.users.getCurrentUser)
}

export function useUserByUsername(username: string | null | undefined) {
  return useQuery(
    api.users.getUserByUsername,
    username ? { username } : 'skip'
  )
}

export function useUserStats(userId: Id<'users'> | undefined) {
  return useQuery(
    api.users.getUserStats,
    userId !== undefined ? { userId } : 'skip'
  )
}
