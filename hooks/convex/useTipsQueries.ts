import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'

export function useMyEarningsSummary() {
  return useQuery(api.tips.getMyEarningsSummary, {})
}
