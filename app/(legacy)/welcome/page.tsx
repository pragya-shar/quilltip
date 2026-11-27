import type { Metadata } from 'next'
import { WelcomeSetup } from '@/components/welcome/WelcomeSetup'
import { SITE_NAME } from '@/lib/seo/siteMetadata'
import '@/components/account/account.css'
import '@/components/profile/public-profile.css'
import '@/components/settings/profile-settings.css'
import '@/components/welcome/welcome.css'

export const metadata: Metadata = {
  title: `Set up your profile · ${SITE_NAME}`,
  robots: { index: false },
}

export default WelcomeSetup
