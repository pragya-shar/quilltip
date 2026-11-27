import type { Metadata } from 'next'
import '@/components/account/account.css'
import { ProfileSettingsPage } from '@/components/settings/ProfileSettingsPage'
import { SITE_NAME } from '@/lib/seo/siteMetadata'

export const metadata: Metadata = {
  title: `Profile settings · ${SITE_NAME}`,
  robots: { index: false },
}

export default ProfileSettingsPage
