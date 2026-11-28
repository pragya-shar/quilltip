'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { OutsideTabActivityList } from './OutsideTabActivityList'

/**
 * Tab events this deployment did not originate (#647). One line per open
 * record; what to do is in the runbook. No addresses are shown. Operators
 * only; the query returns null to everyone else.
 */
export function OutsideTabActivityReview() {
  const outside = useQuery(api.chain.tabOutside.getOutsideTabActivity, {})
  if (!outside) return null
  return <OutsideTabActivityList outside={outside} now={Date.now()} />
}
