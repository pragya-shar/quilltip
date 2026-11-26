'use client'

import type { ReactNode } from 'react'
import { useAuthReturnPath } from './useAuthReturnPath'
import { AccountScreenView } from './AccountScreenView'

/** Account screen that reads its destination from the client URL. */
export function AccountScreen({
  variant,
  children,
}: {
  variant: 'login' | 'register'
  children: ReactNode
}) {
  return (
    <AccountScreenView variant={variant} destination={useAuthReturnPath()}>
      {children}
    </AccountScreenView>
  )
}
