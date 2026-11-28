'use client'

import './addMoney.css'
import { QuickTipsPanel } from './QuickTipsPanel'
import { useAddMoneyServices } from './services'

/**
 * Quick tips in Balance, once its services have loaded (they load with
 * the balance, never in a first load). Nothing shows while they load.
 */
export function QuickTipsSection() {
  const loaded = useAddMoneyServices()
  if (loaded.status !== 'ready') return null
  return <QuickTipsPanel services={loaded.services} />
}
