/**
 * Writes a ledger snapshot for the test accounts to `--out` (JSON):
 *   bun e2e/real-run/snapshot.ts --accounts <file> --out <file> --label before
 */
import { writeFileSync } from 'node:fs'
import { arg, readAccounts } from './lib'
import { chainFigures, convexRows, table } from './ledger'

const { reader, writer } = readAccounts(arg('--accounts')!)
const tab = 'CB2OJSZTDGEA2GPQ5TXXEWBVBDY4SS3XN4B46OTSNQHZNXFF4RBHTLFK'
const users = table<{ _id: string; stellarAddress?: string }>('users', 2000)
const writerUser = users.find((u) => u.stellarAddress === writer.publicKey)
const snapshot = {
  label: arg('--label') ?? 'snapshot',
  at: new Date().toISOString(),
  chain: await chainFigures(tab, reader.publicKey, writer.publicKey),
  convex: convexRows(reader.publicKey, writerUser?._id ?? null),
  writerUserId: writerUser?._id ?? null,
}
writeFileSync(arg('--out')!, JSON.stringify(snapshot, null, 2))
console.log(
  JSON.stringify({
    chain: snapshot.chain,
    receipts: snapshot.convex.receipts.length,
    account: snapshot.convex.account ? 'yes' : 'no',
  })
)
