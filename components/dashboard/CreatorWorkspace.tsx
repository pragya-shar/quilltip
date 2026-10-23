'use client'

import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import type { CreatorWorkspaceProps } from '@/components/dashboard/CreatorWorkspaceShared'
import { CreatorWorkspacePrimaryFallback } from '@/components/dashboard/CreatorWorkspacePrimaryFallback'
import { CreatorWorkspaceContent } from '@/components/dashboard/CreatorWorkspaceContent'

export function CreatorWorkspace({ user }: CreatorWorkspaceProps) {
  return (
    <ErrorBoundary fallback={<CreatorWorkspacePrimaryFallback user={user} />}>
      <CreatorWorkspaceContent user={user} />
    </ErrorBoundary>
  )
}

export { CreatorWorkspaceLoadingShell } from '@/components/dashboard/CreatorWorkspaceLoadingShell'
