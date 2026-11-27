'use client'
import { useAuth } from '@/components/providers/AuthContext'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { WriteEditorWorkspace } from '@/components/editor/WriteEditorWorkspace'
import { WritingLoading } from '@/components/editor/WritingLoading'
import '@/components/editor/writing-workspace.css'
export default function WritePage() {
  const { isAuthenticated, isLoading } = useAuth()
  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)
  if (isLoading || !isAuthenticated) return <WritingLoading />
  return (
    <ErrorBoundary
      fallback={({ reset }) => (
        <WritingLoading
          message="Your writing desk couldn’t load. Your saved drafts are still in your account."
          retry={reset}
        />
      )}
    >
      <WriteEditorWorkspace />
    </ErrorBoundary>
  )
}
