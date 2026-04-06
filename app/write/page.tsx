'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { EditorChromeSkeleton } from '@/components/editor/EditorChromeSkeleton'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { EditorWorkspaceErrorFallback } from '@/components/error/SectionErrorFallback'
import { WriteEditorWorkspace } from '@/components/editor/WriteEditorWorkspace'

export default function WritePage() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <EditorChromeSkeleton />
      </div>
    )
  }

  if (!isAuthenticated) {
    router.push('/login')
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
