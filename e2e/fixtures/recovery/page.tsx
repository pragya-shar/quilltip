import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import RouteError from '../../../app/error'
import Loading from '../../../app/loading'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { ArticleDisplaySectionFallback } from '@/components/error/ArticleDisplaySectionFallback'
import { ArticleSidebarSectionFallback } from '@/components/error/ArticleSidebarSectionFallback'
import { WalletErrorFallback } from '@/components/error/WalletErrorFallback'

// Deliberately fail once, so resetting the real boundary can recover.
const recovered = new Set<string>()
function UnstableSection({ name }: { name: string }) {
  if (!recovered.has(name)) {
    throw new Error(`Controlled ${name} failure`)
  }
  return <p>{name} recovered</p>
}

// A genuine Suspense delay exercises app/loading.tsx for ten seconds.
const DelayedContent = lazy(
  () =>
    new Promise<{ default: () => React.ReactNode }>((resolve) => {
      setTimeout(() => resolve({ default: () => <p>Page loaded</p> }), 10000)
    })
)

function retry(name: string, reset: () => void) {
  recovered.add(name)
  reset()
}

function RecoveryFixtures() {
  const state = new URLSearchParams(window.location.search).get('state')
  if (state === 'loading') {
    return (
      <Suspense fallback={<Loading />}>
        <DelayedContent />
      </Suspense>
    )
  }
  if (state === 'route') {
    return (
      <ErrorBoundary
        fallback={({ reset }) => (
          <RouteError
            error={new Error('Controlled route failure')}
            reset={() => retry('Page', reset)}
          />
        )}
      >
        <UnstableSection name="Page" />
      </ErrorBoundary>
    )
  }
  if (state === 'wallet') {
    return (
      <ErrorBoundary
        fallback={({ reset }) => (
          <WalletErrorFallback onRetry={() => retry('Wallet', reset)} />
        )}
      >
        <UnstableSection name="Wallet" />
      </ErrorBoundary>
    )
  }
  return (
    <main
      className="reader-surface"
      style={{ maxWidth: 800, margin: 'auto', padding: 24 }}
    >
      <h1>Reader recovery fixtures</h1>
      <p>Healthy content stays visible.</p>
      <ErrorBoundary
        fallback={({ reset }) => (
          <ArticleDisplaySectionFallback
            onRetry={() => retry('Article body', reset)}
          />
        )}
      >
        <UnstableSection name="Article body" />
      </ErrorBoundary>
      <ErrorBoundary
        fallback={({ reset }) => (
          <ArticleSidebarSectionFallback
            onRetry={() => retry('Article details', reset)}
          />
        )}
      >
        <UnstableSection name="Article details" />
      </ErrorBoundary>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<RecoveryFixtures />)
