'use client'

import { useAuth } from '@/components/providers/AuthContext'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'
import AppNavigation from '@/components/layout/AppNavigation'
import { EditorChromeSkeleton } from '@/components/editor/EditorChromeSkeleton'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { EditorWorkspaceErrorFallback } from '@/components/error/SectionErrorFallback'
import { WriteEditorWorkspace } from '@/components/editor/WriteEditorWorkspace'
import { LoadingRegion } from '@/components/a11y/LoadingRegion'
import { useStaleLoading } from '@/hooks/useStaleLoading'
import { useRouter } from 'next/navigation'

export default function WritePage() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  const { isStale, reset: resetStale } = useStaleLoading(isLoading)

  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <LoadingRegion
          label="editor"
          isLoading
          isStale={isStale}
          onRetry={() => {
            resetStale()
            router.refresh()
          }}
          fallback={<EditorChromeSkeleton />}
        >
          <div />
        </LoadingRegion>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <ErrorBoundary
        fallback={({ reset }) => (
          <EditorWorkspaceErrorFallback onRetry={reset} />
        )}
      >
        <WriteEditorWorkspace />
      </ErrorBoundary>
    </div>
  )
}
