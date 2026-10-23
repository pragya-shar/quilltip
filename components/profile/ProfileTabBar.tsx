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
      behavior: 'instant',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTab, tabs.length])

  return (
    <div className="profile-tabs">
      <nav
        ref={navRef}
        className="profile-tab-links"
        aria-label="Profile sections"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={getHref(tab.id)}
            scroll={false}
            data-tab={tab.id}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={
              activeTab === tab.id ? 'profile-tab active' : 'profile-tab'
            }
          >
            <tab.icon className="w-4 h-4 shrink-0" />
            <span>{tab.label}</span>
            {tab.count !== null && tab.count > 0 && (
              <span className="profile-tab-count">{tab.count}</span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  )
}
