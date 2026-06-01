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
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export default function AppNavigation() {
  const { user, isAuthenticated, signOut } = useAuth()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  const isActive = (path: string) => pathname === path

  const closeMenu = () => setMenuOpen(false)

  const desktopLinkClass = (active: boolean) =>
    `focus-ring flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
      active
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`

  const mobileLinkClass = (active: boolean) =>
    `focus-ring flex items-center gap-2 px-3 py-2 rounded-lg transition text-sm font-medium ${
      active ? 'bg-muted text-primary' : 'text-foreground hover:bg-muted'
    }`

  return (
    <nav className="fixed top-0 w-full bg-background/95 backdrop-blur-md z-50 border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link
            href="/"
            className="focus-ring flex items-center space-x-2 rounded-md"
            onClick={closeMenu}
          >
            <span className="text-3xl font-handwritten text-foreground">
              Quilltip
            </span>
          </Link>

          <div className="hidden md:flex items-center space-x-6">
            <Link href="/" className={desktopLinkClass(isActive('/'))}>
              <Home className="w-4 h-4" />
              <span>Home</span>
            </Link>
            <Link
              href="/articles"
              className={desktopLinkClass(isActive('/articles'))}
            >
              <BookOpen className="w-4 h-4" />
              <span>Articles</span>
            </Link>
            <Link
              href="/guide"
              className={desktopLinkClass(isActive('/guide'))}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Guide</span>
            </Link>

            <ThemeToggle />

            {isAuthenticated ? (
              <>
                <Link
                  href="/write"
                  className={desktopLinkClass(isActive('/write'))}
                >
                  <PenSquare className="w-4 h-4" />
                  <span>Write</span>
                </Link>
                <Link
                  href="/drafts"
                  className={desktopLinkClass(isActive('/drafts'))}
                >
                  <FileText className="w-4 h-4" />
                  <span>Drafts</span>
                </Link>
                <Link
                  href="/profile"
                  className={desktopLinkClass(
                    pathname === `/${user?.username}` || pathname === '/profile'
                  )}
                >
                  <User className="w-4 h-4" />
                  <span>Profile</span>
                </Link>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="focus-ring flex items-center gap-2 px-3 py-1.5 rounded-lg text-muted-foreground hover:text-destructive transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="focus-ring rounded-md text-muted-foreground hover:text-foreground transition"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="focus-ring bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition"
                >
                  Get Started
                </Link>
              </>
            )}
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

                {isAuthenticated ? (
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
                        pathname === `/${user?.username}` ||
                          pathname === '/profile'
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
                ) : (
                  <div className="flex flex-col gap-2 pt-2 border-t border-border mt-2">
                    <Link
                      href="/login"
                      className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition"
                      onClick={closeMenu}
                    >
                      Sign In
                    </Link>
                    <Link
                      href="/register"
                      className="focus-ring bg-primary text-primary-foreground px-4 py-2.5 rounded-lg hover:bg-primary/90 transition text-center text-sm font-medium"
                      onClick={closeMenu}
                    >
                      Get Started
                    </Link>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  )
}
