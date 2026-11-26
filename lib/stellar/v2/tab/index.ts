/**
 * Browser-side tab (prepaid quick tip) modules. See `README.md` in this
 * folder for the API, the storage layout and how the UI presents each state.
 */
import './buffer-global'

export {
  TabClientError,
  isTabClientError,
  type TabClientErrorCode,
} from './errors'
export {
  ACCEPT_MARGIN_LEDGERS,
  DAY_LEDGERS,
  createSessionKeyStore,
  sessionKeyStatus,
  supportsWebCryptoEd25519,
  tabKeyState,
  type KeyStatus,
  type LocalSessionKeyInfo,
  type ServerSessionKey,
  type SessionKey,
  type SessionKeyBackend,
  type SessionKeyScope,
  type SessionKeyStore,
  type SessionKeyStoreOptions,
} from './session-key'
export {
  MAX_RECEIPTS_PER_PAIR,
  appendLeaf,
  receiptFields,
  receiptLeafHex,
  receiptProofHex,
  receiptsRootHex,
  verifyReceiptHex,
  type StoredReceipt,
} from './merkle'
export {
  PrepareCheckError,
  buildReceipt,
  buildVoucher,
  networkIdOf,
  submitTipArgs,
  voucherPayloadFor,
  type AcceptedVoucher,
  type PrepareProblem,
  type PreparedTabTip,
  type SubmitTipArgs,
  type SubmittedTabTip,
  type UnsignedTabVoucher,
  type VoucherInput,
} from './voucher'
export {
  MAX_SIGNED,
  createLocalLedger,
  decideStepTwo,
  matchLedger,
  type CommitResult,
  type LedgerMatch,
  type LedgerRecord,
  type LedgerState,
  type LocalLedger,
  type LocalLedgerOptions,
  type MismatchReason,
  type ServerPairState,
  type SignedEntry,
  type StepTwoDecision,
} from './local-ledger'
export {
  commitAcceptedTip,
  defaultTabSigningDeps,
  signTabTip,
  type SignTabTipDeps,
  type SignTabTipResult,
  type StopReason,
} from './sign-tip'
export { TAB_DB_NAME, closeTabDb, type TabDbOptions } from './idb'
