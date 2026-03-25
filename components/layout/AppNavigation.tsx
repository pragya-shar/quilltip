'use client'

import Link from 'next/link'
import { useAuth } from '@/components/providers/AuthContext'
import {
  PenSquare,
  Home,
  User,
  LogOut,
  FileText,
  BookOpen,
  HelpCircle,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

export default function AppNavigation() {
  const { user, isAuthenticated, signOut } = useAuth()
  const pathname = usePathname()

  const isActive = (path: string) => pathname === path

  const linkBase =
    'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors'
  const linkInactive = `${linkBase} text-muted-foreground hover:text-primary`
  const linkActive = `${linkBase} bg-muted text-primary`

  return (
    <nav className="fixed top-0 w-full bg-background/95 backdrop-blur-md z-50 border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-3xl font-handwritten text-foreground">
              Quilltip
            </span>
          </Link>

          <div className="flex items-center space-x-4 md:space-x-6">
            <ThemeToggle />
            <Link
              href="/"
              className={isActive('/') ? linkActive : linkInactive}
            >
              <Home className="w-4 h-4" />
              <span>Home</span>
            </Link>
            <Link
              href="/articles"
              className={isActive('/articles') ? linkActive : linkInactive}
            >
              <BookOpen className="w-4 h-4" />
              <span>Articles</span>
            </Link>
            <Link
              href="/guide"
              className={isActive('/guide') ? linkActive : linkInactive}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Guide</span>
            </Link>

            {isAuthenticated ? (
              <>
                <Link
                  href="/write"
                  className={isActive('/write') ? linkActive : linkInactive}
                >
                  <PenSquare className="w-4 h-4" />
                  <span>Write</span>
                </Link>
                <Link
                  href="/drafts"
                  className={isActive('/drafts') ? linkActive : linkInactive}
                >
                  <FileText className="w-4 h-4" />
                  <span>Drafts</span>
                </Link>
                <Link
                  href={`/${user?.username || 'profile'}`}
                  className={
                    pathname === `/${user?.username}` ? linkActive : linkInactive
                  }
                >
                  <User className="w-4 h-4" />
                  <span>Profile</span>
                </Link>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
