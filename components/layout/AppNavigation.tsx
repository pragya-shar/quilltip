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
import { ThemeToggle } from '@/components/theme/ThemeToggle'

export default function AppNavigation() {
  const { user, isAuthenticated, signOut } = useAuth()
  const pathname = usePathname()

  const isActive = (path: string) => pathname === path

  return (
    <nav className="fixed top-0 w-full bg-background/95 backdrop-blur-md z-50 border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-3xl font-handwritten text-foreground">
              Quilltip
            </span>
          </Link>

          <div className="flex items-center space-x-4 sm:space-x-6">
            <Link
              href="/"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
                isActive('/')
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>Home</span>
            </Link>
            <Link
              href="/articles"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
                isActive('/articles')
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Articles</span>
            </Link>
            <Link
              href="/guide"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
                isActive('/guide')
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Guide</span>
            </Link>

            <ThemeToggle />

            {isAuthenticated ? (
              <>
                <Link
                  href="/write"
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
                    isActive('/write')
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <PenSquare className="w-4 h-4" />
                  <span>Write</span>
                </Link>
                <Link
                  href="/drafts"
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
                    isActive('/drafts')
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <span>Drafts</span>
                </Link>
                <Link
                  href={`/${user?.username || 'profile'}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
                    pathname === `/${user?.username}`
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span>Profile</span>
                </Link>
                <button
                  onClick={() => signOut()}
                  className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-destructive transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition"
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
