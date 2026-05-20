'use client'

import { useAuth } from '@/components/providers/AuthContext'
import Navigation from '@/components/landing/Navigation'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'

type InfoPageLayoutProps = {
  title: string
  description?: string
  children: React.ReactNode
}

export function InfoPageLayout({
  title,
  description,
  children,
}: InfoPageLayoutProps) {
  const { isAuthenticated } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {isAuthenticated ? <AppNavigation /> : <Navigation />}
      <div className="flex-1 pt-24 pb-16 px-4">
        <div className="mx-auto max-w-3xl">
          <header className="mb-10 border-b border-border pb-8">
            <h1 className="font-display text-3xl lg:text-4xl font-medium tracking-[-0.01em] text-foreground">
              {title}
            </h1>
            {description ? (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </header>
          {children}
        </div>
      </div>
      <SiteFooter variant="default" />
    </div>
  )
}
