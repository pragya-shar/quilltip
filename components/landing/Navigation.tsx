'use client'

import Link from 'next/link'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ArrowRight,
  Menu,
  PenTool,
  Zap,
  Highlighter,
  HelpCircle,
  FileText,
  Shield,
  ChevronDown,
  BookOpen,
  Coins,
  Globe,
  Sparkles,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { LucideIcon } from 'lucide-react'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface NavDropdownItem {
  icon: LucideIcon
  title: string
  description: string
  href: string
  badge?: string
}

interface NavDropdownColumn {
  heading: string
  items: NavDropdownItem[]
}

interface NavFeatured {
  title: string
  description: string
  href: string
  bgClass: string
  icon: LucideIcon
}

interface NavDropdown {
  label: string
  featured: NavFeatured
  columns: NavDropdownColumn[]
}

const navDropdowns: NavDropdown[] = [
  {
    label: 'Product',
    featured: {
      title: 'Quilltip Platform',
      description:
        'Write, publish, and earn — all in one decentralized platform built on Stellar.',
      href: '#features',
      bgClass: 'bg-gradient-to-br from-muted/70 to-muted',
      icon: PenTool,
    },
    columns: [
      {
        heading: 'Features',
        items: [
          {
            icon: PenTool,
            title: 'Rich Editor',
            description: 'Write with markdown & media',
            href: '#features',
          },
          {
            icon: Highlighter,
            title: 'Highlights',
            description: 'Readers tip specific passages',
            href: '#features',
          },
          {
            icon: Sparkles,
            title: 'NFT Minting',
            description: 'Mint articles as collectibles',
            href: '#features',
          },
        ],
      },
      {
        heading: 'Earn',
        items: [
          {
            icon: Zap,
            title: 'Instant Tips',
            description: 'Get paid via Stellar network',
            href: '#how-it-works',
          },
          {
            icon: Coins,
            title: 'Low Fees',
            description: '97.5% goes directly to you',
            href: '#how-it-works',
          },
          {
            icon: Globe,
            title: 'Permanent Storage',
            description: 'Articles stored on Arweave',
            href: '#how-it-works',
          },
        ],
      },
    ],
  },
  {
    label: 'Resources',
    featured: {
      title: 'Getting Started',
      description:
        'Set up your wallet and start earning tips in under 5 minutes.',
      href: '/guide',
      bgClass: 'bg-gradient-to-br from-muted/60 to-muted',
      icon: BookOpen,
    },
    columns: [
      {
        heading: 'Learn',
        items: [
          {
            icon: FileText,
            title: 'Wallet Guide',
            description: 'Set up Freighter wallet',
            href: '/guide',
          },
          {
            icon: HelpCircle,
            title: 'FAQ',
            description: 'Common questions answered',
            href: '#faq',
          },
        ],
      },
      {
        heading: 'Trust & Safety',
        items: [
          {
            icon: Shield,
            title: 'Security',
            description: 'Blockchain security overview',
            href: '#faq',
          },
          {
            icon: Globe,
            title: 'Arweave Storage',
            description: 'How permanent storage works',
            href: '#faq',
          },
        ],
      },
    ],
  },
]

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMouseEnter = useCallback((label: string) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setOpenDropdown(label)
  }, [])

  const handleMouseLeave = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpenDropdown(null)
    }, 150)
  }, [])

  const toggleDropdown = useCallback((label: string) => {
    setOpenDropdown((prev) => (prev === label ? null : label))
  }, [])

  useEffect(() => {
    if (!openDropdown) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDropdown(null)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [openDropdown])

  const handleSmoothScroll = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (href.startsWith('#')) {
      e.preventDefault()
      const element = document.querySelector(href)
      if (element) {
        const offsetTop =
          element.getBoundingClientRect().top + window.pageYOffset - 80
        window.scrollTo({
          top: offsetTop,
          behavior: 'smooth',
        })
      }
      setIsOpen(false)
      setOpenDropdown(null)
    }
  }

  const headerSolid = scrolled || isOpen

  return (
    <motion.nav
      className={`fixed top-0 w-full z-50 transition-all duration-500 ${
        headerSolid
          ? 'bg-background border-b border-border shadow-sm'
          : 'bg-transparent'
      }`}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: [0.6, -0.05, 0.01, 0.99] }}
    >
      <div className="container mx-auto max-w-7xl px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link
            href="/"
            className="focus-ring flex items-center gap-3 group rounded-lg"
          >
            <motion.div
              className="w-9 h-9 bg-gradient-to-br from-brand-blue to-brand-accent rounded-xl flex items-center justify-center shadow-sm"
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            >
              <PenTool className="w-[18px] h-[18px] text-brand-foreground" />
            </motion.div>
            <span className="text-[22px] font-semibold text-foreground tracking-tight">
              Quilltip
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1" ref={navRef}>
            <Link
              href="/articles"
              className="focus-ring px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60 transition-all duration-200"
            >
              Articles
            </Link>
            {navDropdowns.map((dropdown) => (
              <div
                key={dropdown.label}
                className="relative"
                onMouseEnter={() => handleMouseEnter(dropdown.label)}
                onMouseLeave={handleMouseLeave}
              >
                <button
                  type="button"
                  aria-expanded={openDropdown === dropdown.label}
                  aria-haspopup="true"
                  className={`focus-ring flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium rounded-lg transition-all duration-200 ${
                    openDropdown === dropdown.label
                      ? 'text-foreground bg-muted/60'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  }`}
                  onClick={() => toggleDropdown(dropdown.label)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleDropdown(dropdown.label)
                    }
                  }}
                >
                  {dropdown.label}
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      openDropdown === dropdown.label ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {openDropdown === dropdown.label && (
                    <>
                      {/* Invisible bridge to prevent gap hover loss */}
                      <div className="absolute top-full left-0 h-3 w-full" />
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="absolute top-[calc(100%+8px)] right-0 w-[min(560px,calc(100vw-2rem))] bg-popover text-popover-foreground rounded-2xl shadow-xl border border-border"
                      >
                        <div className="flex min-w-0">
                          {/* Featured card */}
                          <Link
                            href={dropdown.featured.href}
                            onClick={(e) =>
                              handleSmoothScroll(e, dropdown.featured.href)
                            }
                            className={`focus-ring w-[200px] shrink-0 p-5 ${dropdown.featured.bgClass} flex flex-col justify-between group/featured rounded-l-2xl`}
                          >
                            <div>
                              <div className="w-10 h-10 bg-card/80 rounded-xl flex items-center justify-center mb-3 shadow-sm">
                                <dropdown.featured.icon className="w-5 h-5 text-foreground" />
                              </div>
                              <p className="text-[14px] font-semibold text-foreground mb-1.5">
                                {dropdown.featured.title}
                              </p>
                              <p className="text-[12px] text-muted-foreground leading-relaxed">
                                {dropdown.featured.description}
                              </p>
                            </div>
                            <span className="text-[12px] font-medium text-muted-foreground group-hover/featured:text-foreground transition-colors mt-4 inline-flex items-center gap-1">
                              Learn more
                              <ArrowRight className="w-3 h-3 shrink-0 transition-transform group-hover/featured:translate-x-0.5" />
                            </span>
                          </Link>

                          {/* Columns */}
                          <div className="flex-1 p-4 flex gap-1">
                            {dropdown.columns.map((column) => (
                              <div key={column.heading} className="flex-1">
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2.5 mb-2">
                                  {column.heading}
                                </p>
                                <div className="space-y-0.5">
                                  {column.items.map((item) => (
                                    <Link
                                      key={item.title}
                                      href={item.href}
                                      onClick={(e) => {
                                        handleSmoothScroll(e, item.href)
                                        setOpenDropdown(null)
                                      }}
                                      className="focus-ring flex items-start gap-2.5 px-2.5 py-2 rounded-xl hover:bg-muted/50 transition-colors duration-150 group/item"
                                    >
                                      <div className="w-8 h-8 bg-muted group-hover/item:bg-muted/80 rounded-lg flex items-center justify-center shrink-0 transition-colors">
                                        <item.icon className="w-4 h-4 text-muted-foreground" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                                          {item.title}
                                          {item.badge && (
                                            <span className="text-[10px] font-semibold bg-success text-success-foreground px-1.5 py-0.5 rounded-full">
                                              {item.badge}
                                            </span>
                                          )}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground leading-snug">
                                          {item.description}
                                        </p>
                                      </div>
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ))}

            <div className="w-px h-5 bg-border mx-2" />

            <ThemeToggle />

            <Link
              href="/login"
              className="focus-ring px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60 transition-all duration-200"
            >
              Sign In
            </Link>

            <Link
              href="/register"
              className="focus-ring inline-flex items-center gap-1.5 bg-brand text-brand-foreground px-4 py-1.5 rounded-lg text-[13px] font-medium hover:bg-brand-hover transition-all duration-200 ml-1"
            >
              Try on Testnet
              <ArrowRight className="w-3.5 h-3.5 shrink-0 text-brand-foreground/80" />
            </Link>
          </div>

          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="focus-ring md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
                aria-expanded={isOpen}
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
          <div className="px-4 pt-14 pb-6 space-y-4 overflow-y-auto">
            <Link
              href="/articles"
              className="focus-ring flex items-center gap-3 py-2 rounded-lg text-foreground hover:bg-muted text-sm font-medium transition-colors"
              onClick={() => setIsOpen(false)}
            >
              Articles
            </Link>
            {navDropdowns.map((dropdown) => (
              <div key={dropdown.label}>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                  {dropdown.label}
                </p>
                <div className="space-y-0.5">
                  {dropdown.columns.map((column) =>
                    column.items.map((item) => (
                      <Link
                        key={item.title}
                        href={item.href}
                        className="focus-ring flex items-center gap-2.5 py-2 px-1 rounded-lg text-foreground hover:bg-muted transition-colors"
                        onClick={(e) => {
                          handleSmoothScroll(e, item.href)
                          setIsOpen(false)
                        }}
                      >
                        <div className="w-7 h-7 bg-muted rounded-lg flex items-center justify-center shrink-0">
                          <item.icon className="w-3.5 h-3.5 text-foreground" />
                        </div>
                        <span className="text-sm font-medium">
                          {item.title}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            ))}

            <div className="pt-3 space-y-2 border-t border-border">
              <Link
                href="/login"
                className="focus-ring block rounded-lg text-foreground hover:bg-muted text-sm font-medium transition-colors py-2 px-1"
                onClick={() => setIsOpen(false)}
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="focus-ring inline-flex w-full items-center justify-center gap-1.5 bg-brand text-brand-foreground px-5 py-2.5 rounded-lg hover:bg-brand-hover transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Try on Testnet
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-brand-foreground/80" />
              </Link>
            </div>
          </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </motion.nav>
  )
}
