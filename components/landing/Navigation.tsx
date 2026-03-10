'use client'

import Link from 'next/link'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Menu,
  X,
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
import { motion, AnimatePresence } from 'framer-motion'
import { LucideIcon } from 'lucide-react'

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
      bgClass: 'bg-gradient-to-br from-blue-50 to-indigo-100',
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
      bgClass: 'bg-gradient-to-br from-amber-50 to-orange-100',
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

  return (
    <motion.nav
      className={`fixed top-0 w-full z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-white/70 backdrop-blur-xl border-b border-neutral-200/40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
          : 'bg-transparent'
      }`}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: [0.6, -0.05, 0.01, 0.99] }}
    >
      <div className="container mx-auto max-w-7xl px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <motion.div
              className="w-9 h-9 bg-gradient-to-br from-neutral-900 to-neutral-700 rounded-xl flex items-center justify-center shadow-sm"
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            >
              <PenTool className="w-[18px] h-[18px] text-white" />
            </motion.div>
            <span className="text-[22px] font-semibold text-neutral-900 tracking-tight">
              Quilltip
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1" ref={navRef}>
            <Link
              href="/articles"
              className="px-3 py-1.5 text-[13px] font-medium text-neutral-600 hover:text-neutral-900 rounded-lg hover:bg-neutral-100/60 transition-all duration-200"
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
                  className={`flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium rounded-lg transition-all duration-200 ${
                    openDropdown === dropdown.label
                      ? 'text-neutral-900 bg-neutral-100/60'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/60'
                  }`}
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
                        className="absolute top-[calc(100%+8px)] right-0 w-[560px] bg-white rounded-2xl shadow-xl shadow-neutral-900/8 border border-neutral-200/60 overflow-hidden"
                        style={{
                          transform:
                            dropdown.label === 'Product'
                              ? 'translateX(10%)'
                              : 'translateX(30%)',
                        }}
                      >
                        <div className="flex">
                          {/* Featured card */}
                          <Link
                            href={dropdown.featured.href}
                            onClick={(e) =>
                              handleSmoothScroll(e, dropdown.featured.href)
                            }
                            className={`w-[200px] shrink-0 p-5 ${dropdown.featured.bgClass} flex flex-col justify-between group/featured`}
                          >
                            <div>
                              <div className="w-10 h-10 bg-white/70 rounded-xl flex items-center justify-center mb-3 shadow-sm">
                                <dropdown.featured.icon className="w-5 h-5 text-neutral-700" />
                              </div>
                              <p className="text-[14px] font-semibold text-neutral-900 mb-1.5">
                                {dropdown.featured.title}
                              </p>
                              <p className="text-[12px] text-neutral-600 leading-relaxed">
                                {dropdown.featured.description}
                              </p>
                            </div>
                            <span className="text-[12px] font-medium text-neutral-500 group-hover/featured:text-neutral-800 transition-colors mt-4 inline-flex items-center gap-1">
                              Learn more
                              <span className="transition-transform group-hover/featured:translate-x-0.5">
                                →
                              </span>
                            </span>
                          </Link>

                          {/* Columns */}
                          <div className="flex-1 p-4 flex gap-1">
                            {dropdown.columns.map((column) => (
                              <div key={column.heading} className="flex-1">
                                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider px-2.5 mb-2">
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
                                      className="flex items-start gap-2.5 px-2.5 py-2 rounded-xl hover:bg-neutral-50 transition-colors duration-150 group/item"
                                    >
                                      <div className="w-8 h-8 bg-neutral-100 group-hover/item:bg-neutral-200/70 rounded-lg flex items-center justify-center shrink-0 transition-colors">
                                        <item.icon className="w-4 h-4 text-neutral-500" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[13px] font-medium text-neutral-900 flex items-center gap-1.5">
                                          {item.title}
                                          {item.badge && (
                                            <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                                              {item.badge}
                                            </span>
                                          )}
                                        </p>
                                        <p className="text-[11px] text-neutral-400 leading-snug">
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

            <div className="w-px h-5 bg-neutral-200 mx-2" />

            <Link
              href="/login"
              className="px-3 py-1.5 text-[13px] font-medium text-neutral-600 hover:text-neutral-900 rounded-lg hover:bg-neutral-100/60 transition-all duration-200"
            >
              Sign In
            </Link>

            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 bg-neutral-900 text-white px-4 py-1.5 rounded-lg text-[13px] font-medium hover:bg-neutral-800 transition-all duration-200 ml-1"
            >
              Try on Testnet
              <span className="text-neutral-400">→</span>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-neutral-100 transition-colors"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            {isOpen ? (
              <X size={22} className="text-neutral-900" />
            ) : (
              <Menu size={22} className="text-neutral-900" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              className="md:hidden border-t border-neutral-200/60"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="py-4 space-y-4">
                <Link
                  href="/articles"
                  className="flex items-center gap-3 py-1.5 text-neutral-600 hover:text-neutral-900 text-sm font-medium transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  Articles
                </Link>
                {navDropdowns.map((dropdown, dropdownIndex) => (
                  <motion.div
                    key={dropdown.label}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: dropdownIndex * 0.1 }}
                  >
                    <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                      {dropdown.label}
                    </p>
                    <div className="space-y-0.5">
                      {dropdown.columns.map((column) =>
                        column.items.map((item) => (
                          <Link
                            key={item.title}
                            href={item.href}
                            className="flex items-center gap-2.5 py-1.5 text-neutral-600 hover:text-neutral-900 transition-colors"
                            onClick={(e) => {
                              handleSmoothScroll(e, item.href)
                              setIsOpen(false)
                            }}
                          >
                            <div className="w-7 h-7 bg-neutral-100 rounded-lg flex items-center justify-center">
                              <item.icon className="w-3.5 h-3.5 text-neutral-500" />
                            </div>
                            <span className="text-sm font-medium">
                              {item.title}
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                  </motion.div>
                ))}

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: navDropdowns.length * 0.1,
                  }}
                  className="pt-3 space-y-2 border-t border-neutral-200/60"
                >
                  <Link
                    href="/login"
                    className="block text-neutral-600 hover:text-neutral-900 text-sm font-medium transition-colors py-1.5"
                    onClick={() => setIsOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    className="block bg-neutral-900 text-white px-5 py-2.5 rounded-lg hover:bg-neutral-800 transition-colors text-center text-sm font-medium"
                    onClick={() => setIsOpen(false)}
                  >
                    Try on Testnet →
                  </Link>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.nav>
  )
}
