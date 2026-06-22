'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import type { ProfileTabId } from '@/lib/profile/profileTab'

export type ProfileTabBarItem = {
  id: ProfileTabId
  label: string
  icon: LucideIcon
  count: number | null
}

type ProfileTabBarProps = {
  tabs: ProfileTabBarItem[]
  activeTab: ProfileTabId
  getHref: (tabId: ProfileTabId) => string
}

export function ProfileTabBar({
  tabs,
  activeTab,
  getHref,
}: ProfileTabBarProps) {
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>(
      `[data-tab="${activeTab}"]`
    )
    el?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTab, tabs.length])

  return (
    <div className="min-w-0 w-full overflow-hidden border-b border-border mb-8">
      <nav
        ref={navRef}
        className="-mb-px flex flex-nowrap gap-4 sm:gap-8 overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] pb-0.5 [scrollbar-width:thin]"
        aria-label="Profile sections"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={getHref(tab.id)}
            scroll={false}
            data-tab={tab.id}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`shrink-0 flex items-center gap-2 py-3 px-3 min-h-[44px] touch-manipulation border-b-2 font-medium text-sm transition-colors ${
              activeTab === tab.id
                ? 'border-brand-blue text-foreground dark:border-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <tab.icon className="w-4 h-4 shrink-0" />
            <span>{tab.label}</span>
            {tab.count !== null && tab.count > 0 && (
              <span className="ml-1 bg-muted text-muted-foreground px-2 py-0.5 rounded-full text-xs">
                {tab.count}
              </span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  )
}
