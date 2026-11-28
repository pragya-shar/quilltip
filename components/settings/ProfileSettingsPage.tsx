'use client'

import Link from 'next/link'
import { ARTICLE_LINK_PREFETCH } from '@/lib/articles/linkPrefetch'
import { ArrowUpRight } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'
import { AccountSurface } from '@/components/account/AccountSurface'
import { ProfileDetailsForm } from './ProfileDetailsForm'
import { ProfileIdentitySettings } from './ProfileIdentitySettings'
import { ProfileSettingsSkeleton } from './ProfileSettingsSkeleton'
import '@/components/profile/public-profile.css'
import './profile-settings.css'

export function ProfileSettingsPage() {
  const { user, isAuthenticated, isLoading } = useAuth()
  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)

  if (!isAuthenticated && !isLoading) return null

  return (
    <AccountSurface>
      {isLoading || !user ? (
        <>
          <p className="sr-only" role="status">
            Loading your profile settings.
          </p>
          <ProfileSettingsSkeleton />
        </>
      ) : (
        <section
          className="profile-settings"
          aria-labelledby="profile-settings-title"
        >
          <header className="account-heading settings-heading">
            <div>
              <h1 id="profile-settings-title">Profile</h1>
              <p>
                What readers see on your writer page and next to your articles.
              </p>
            </div>
            <Link
              className="settings-text-link"
              href={`/${encodeURIComponent(user.username)}`}
              prefetch={ARTICLE_LINK_PREFETCH}
            >
              View public profile <ArrowUpRight aria-hidden size={18} />
            </Link>
          </header>
          <ProfileIdentitySettings
            name={user.name || user.username}
            username={user.username}
            avatar={user.avatar}
          />
          <ProfileDetailsForm
            key={user._id}
            initialName={user.name ?? ''}
            initialBio={user.bio ?? ''}
          />
        </section>
      )}
    </AccountSurface>
  )
}
