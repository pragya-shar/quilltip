'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import {
  PenSquare,
  Home,
  User,
  LogOut,
  FileText,
  BookOpen,
  HelpCircle,
  Menu,
  ArrowRight,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Logo } from '@/components/ui/Logo'
import { NAV_SIGN_IN, NAV_TRY_ON_TESTNET } from '@/lib/copy/nav-cta'

function AuthActionsSkeleton() {
  return <div className="h-9 w-24 rounded-lg bg-muted animate-pulse" aria-hidden />
}

export default function AppNavigation() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  const isActive = (path: string) => pathname === path

  const closeMenu = () => setMenuOpen(false)

  const desktopLinkClass = (
    active: boolean,
    options?: { largeScreenOnly?: boolean }
  ) =>
    `${options?.largeScreenOnly ? 'hidden lg:flex ' : ''}focus-ring inline-flex shrink-0 whitespace-nowrap items-center gap-2 px-3 py-1.5 rounded-lg transition ${
      active
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`

  const desktopSignOutClass =
    'focus-ring inline-flex shrink-0 whitespace-nowrap items-center gap-2 px-3 py-1.5 rounded-lg text-muted-foreground hover:text-destructive transition'

  const mobileLinkClass = (active: boolean) =>
    `focus-ring flex items-center gap-2 px-3 py-2 rounded-lg transition text-sm font-medium ${
      active ? 'bg-muted text-primary' : 'text-foreground hover:bg-muted'
    }`

  const renderDesktopAuthActions = () => {
    if (isLoading) {
      return <AuthActionsSkeleton />
    }

    if (isAuthenticated) {
      return (
        <>
          <Link
            href="/write"
            className={desktopLinkClass(isActive('/write'))}
          >
            <PenSquare className="w-4 h-4 shrink-0" />
            <span>Write</span>
          </Link>
          <Link
            href="/drafts"
            className={desktopLinkClass(isActive('/drafts'), {
              largeScreenOnly: true,
            })}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>Drafts</span>
          </Link>
          <Link
            href="/profile"
            className={desktopLinkClass(
              pathname === `/${user?.username}` || pathname === '/profile',
              { largeScreenOnly: true }
            )}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>Profile</span>
          </Link>
          <button
            type="button"
            onClick={() => signOut()}
            className={desktopSignOutClass}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </>
      )
    }

    return (
      <>
        <Link
          href="/login"
          className="focus-ring shrink-0 whitespace-nowrap px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60 transition-all duration-200"
        >
          {NAV_SIGN_IN}
        </Link>
        <Link
          href="/register"
          className="focus-ring inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 bg-brand text-brand-foreground px-4 py-1.5 rounded-lg text-[13px] font-medium hover:bg-brand-hover transition-all duration-200"
        >
          {NAV_TRY_ON_TESTNET}
          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-brand-foreground/80" />
        </Link>
      </>
    )
  }

  const renderMobileAuthActions = () => {
    if (isLoading) {
      return (
        <div className="pt-2 mt-2 border-t border-border">
          <AuthActionsSkeleton />
        </div>
      )
    }

    if (isAuthenticated) {
      return (
        <>
          <Link
            href="/write"
            className={mobileLinkClass(isActive('/write'))}
            onClick={closeMenu}
          >
            <PenSquare className="w-4 h-4 shrink-0" />
            <span>Write</span>
          </Link>
          <Link
            href="/drafts"
            className={mobileLinkClass(isActive('/drafts'))}
            onClick={closeMenu}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>Drafts</span>
          </Link>
          <Link
            href="/profile"
            className={mobileLinkClass(
              pathname === `/${user?.username}` || pathname === '/profile'
            )}
            onClick={closeMenu}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>Profile</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              signOut()
            }}
            className="focus-ring flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted hover:text-destructive transition text-left"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </>
      )
    }

    return (
      <div className="flex flex-col gap-2 pt-2 border-t border-border mt-2">
        <Link
          href="/login"
          className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition"
          onClick={closeMenu}
        >
          {NAV_SIGN_IN}
        </Link>
        <Link
          href="/register"
          className="focus-ring inline-flex w-full items-center justify-center gap-1.5 bg-brand text-brand-foreground px-5 py-2.5 rounded-lg hover:bg-brand-hover transition-colors text-sm font-medium"
          onClick={closeMenu}
        >
          {NAV_TRY_ON_TESTNET}
          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-brand-foreground/80" />
        </Link>
      </div>
    )
  }

  return (
    <nav className="fixed top-0 w-full bg-background/95 backdrop-blur-md z-50 border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex min-w-0 items-center gap-8">
            <Logo onClick={closeMenu} className="shrink-0" />

            <div className="hidden md:flex min-w-0 items-center gap-4 lg:gap-6">
              <Link href="/" className={desktopLinkClass(isActive('/'))}>
                <Home className="w-4 h-4 shrink-0" />
                <span>Home</span>
              </Link>
              <Link
                href="/articles"
                className={desktopLinkClass(isActive('/articles'))}
              >
                <BookOpen className="w-4 h-4 shrink-0" />
                <span>Articles</span>
              </Link>
              <Link
                href="/guide"
                className={desktopLinkClass(isActive('/guide'))}
              >
                <HelpCircle className="w-4 h-4 shrink-0" />
                <span>Guide</span>
              </Link>

              {renderDesktopAuthActions()}

              <ThemeToggle />
            </div>
          </div>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="focus-ring md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
                aria-expanded={menuOpen}
                aria-label="Toggle menu"
              >
                <Menu size={22} className="text-foreground" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-full sm:max-w-sm p-0 flex flex-col"
            >
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <div className="flex flex-col gap-1 px-4 pt-14 pb-6 overflow-y-auto">
                <Link
                  href="/"
                  className={mobileLinkClass(isActive('/'))}
                  onClick={closeMenu}
                >
                  <Home className="w-4 h-4 shrink-0" />
                  <span>Home</span>
                </Link>
                <Link
                  href="/articles"
                  className={mobileLinkClass(isActive('/articles'))}
                  onClick={closeMenu}
                >
                  <BookOpen className="w-4 h-4 shrink-0" />
                  <span>Articles</span>
                </Link>
                <Link
                  href="/guide"
                  className={mobileLinkClass(isActive('/guide'))}
                  onClick={closeMenu}
                >
                  <HelpCircle className="w-4 h-4 shrink-0" />
                  <span>Guide</span>
                </Link>

                {renderMobileAuthActions()}

                <div className="flex justify-end pt-3 mt-2 border-t border-border">
                  <ThemeToggle />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  )
}
