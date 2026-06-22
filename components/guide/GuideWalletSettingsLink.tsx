import Link from 'next/link'
import { WALLET_PROFILE_HUB_PATH } from '@/lib/navigation/walletProfileDestination'

const linkClassName =
  'inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground text-sm rounded-lg border border-border hover:bg-muted/80 transition-colors'

export function GuideWalletSettingsLink() {
  return (
    <Link href={WALLET_PROFILE_HUB_PATH} className={linkClassName}>
      Go to Profile Settings
    </Link>
  )
}
