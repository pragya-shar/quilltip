import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  type Account,
  type Transaction,
} from '@stellar/stellar-sdk'
import { loadWalletKit } from './wallet-kit-loader'
export const RECIPIENT =
  'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
export const AMOUNT = '1'
export const PENDING_KEY = 'quilltip-testnet-practice-v1'
export type PracticeStatus = 'unknown' | 'confirmed' | 'failed' | 'expired'
export type PracticeRecord = {
  hash: string
  address: string
  expires: number
  status: PracticeStatus
}
export const server = new Horizon.Server('https://horizon-testnet.stellar.org')
export function buildPractice(account: Account) {
  if (account.accountId() === RECIPIENT)
    throw new Error(
      'Use a different wallet for practice; this is the receiving account.'
    )
  return new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: RECIPIENT,
        asset: Asset.native(),
        amount: AMOUNT,
      })
    )
    .addMemo(Memo.text('QuillTip wallet practice'))
    .setTimeout(180)
    .build()
}
export function validateSigned(xdr: string, original: Transaction) {
  const signed = TransactionBuilder.fromXDR(xdr, Networks.TESTNET)
  if (
    signed.hash().toString('hex') !== original.hash().toString('hex') ||
    !signed.signatures.length
  )
    throw new Error(
      'The wallet returned a different or unsigned transaction. Nothing was submitted.'
    )
  return signed
}
export function parsePracticeRecord(raw: string | null): PracticeRecord | null {
  try {
    const r = JSON.parse(raw || 'null')
    if (
      !r ||
      !/^([a-f0-9]{64})$/.test(r.hash) ||
      !StrKey.isValidEd25519PublicKey(r.address) ||
      !Number.isFinite(r.expires) ||
      r.expires <= 0
    )
      return null
    return {
      hash: r.hash,
      address: r.address,
      expires: r.expires,
      status: 'unknown',
    }
  } catch {
    return null
  }
}
type HorizonReader = {
  ledgers: () => {
    order: (direction: 'desc') => {
      limit: (limit: number) => {
        call: () => Promise<{ records: { closed_at: string }[] }>
      }
    }
  }
  transactions: () => {
    transaction: (hash: string) => {
      call: () => Promise<{ successful: boolean }>
    }
  }
}
export async function checkPractice(
  record: Pick<PracticeRecord, 'hash' | 'expires'>,
  horizon: HorizonReader = server
): Promise<PracticeStatus> {
  const ledgers = await horizon.ledgers().order('desc').limit(1).call()
  const closed = Date.parse(ledgers.records[0]?.closed_at || '')
  try {
    return (await horizon.transactions().transaction(record.hash).call())
      .successful
      ? 'confirmed'
      : 'failed'
  } catch (error) {
    if ((error as { response?: { status: number } }).response?.status !== 404)
      throw error
    return closed > record.expires ? 'expired' : 'unknown'
  }
}
export async function makeKit() {
  const {
    StellarWalletsKit,
    FreighterModule,
    xBullModule,
    AlbedoModule,
    WalletNetwork,
  } = await loadWalletKit()
  return new StellarWalletsKit({
    network: WalletNetwork.TESTNET,
    modules: [new FreighterModule(), new xBullModule(), new AlbedoModule()],
  })
}
export type PracticeKit = Awaited<ReturnType<typeof makeKit>>
export async function ensureNetwork(kit: PracticeKit, id: string) {
  if (
    id === 'freighter' &&
    (await kit.getNetwork()).networkPassphrase !== Networks.TESTNET
  )
    throw new Error(
      'Switch Freighter to Testnet, then try again. No transaction was sent.'
    )
}
export { Networks }
