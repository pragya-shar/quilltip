import { useEarlyScripts } from '@/components/providers/Providers'

/**
 * Keeps focus out of the page behind the mobile menu popover before the page
 * scripts run, and records whether the reader opened it
 * (lib/navigation/earlyMenu.ts). AppNavigation writes it into the server HTML
 * just before the menu button, so it runs before the button is parsed, and
 * drops it once the scripts run. The text comes from the root layout through
 * Providers, so it is not in the client bundle, and pages without the header
 * do not carry it.
 */
export function EarlyMenuScript() {
  const { nonce, menu } = useEarlyScripts()
  if (!menu) return null
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: menu }} />
}
