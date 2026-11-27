import { preflight } from './lib'

/** Stops the run before any test when the target is not the v3 testnet. */
export default async function globalSetup() {
  const expect = process.env.REAL_RUN_EXPECT
  if (!expect) throw new Error('Set REAL_RUN_EXPECT to the expected env file.')
  if (!process.env.REAL_RUN_ACCOUNTS)
    throw new Error('Set REAL_RUN_ACCOUNTS to the slice accounts file.')
  await preflight(expect)
}
