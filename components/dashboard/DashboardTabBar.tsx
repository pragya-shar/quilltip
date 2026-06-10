'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import type { DashboardTabId } from '@/lib/dashboard/dashboardTab'
import { getDashboardTabPath } from '@/lib/dashboard/dashboardTab'

export type DashboardTabBarItem = {
  id: DashboardTabId
  label: string
  icon: LucideIcon
}

type DashboardTabBarProps = {
  tabs: DashboardTabBarItem[]
  activeTab: DashboardTabId
}

export function DashboardTabBar({ tabs, activeTab }: DashboardTabBarProps) {
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
        aria-label="Dashboard sections"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={getDashboardTabPath(tab.id)}
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
          </Link>
        ))}
      </nav>
    </div>
  )
}
