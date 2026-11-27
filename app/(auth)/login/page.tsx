import type { Metadata } from 'next'
import LoginForm from '@/components/auth/LoginForm'
import { AccountScreenView } from '@/components/auth/AccountScreenView'
import {
  resolveAuthReturnPath,
  searchParamsRecordReader,
} from '@/lib/auth/safeReturnPath'

export const metadata: Metadata = { title: 'Welcome back. · Quilltip' }

/**
 * Reads the return path on the server, so the first HTML holds the whole
 * screen. A client `useSearchParams` here would leave the page blank until
 * its script runs.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const destination = resolveAuthReturnPath(
    searchParamsRecordReader(await searchParams)
  )
  return (
    <AccountScreenView variant="login" destination={destination}>
      <LoginForm returnToPath={destination} />
    </AccountScreenView>
  )
}
