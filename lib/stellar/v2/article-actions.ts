/**
 * Runs one article action end to end on the client
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.1):
 * prepare (Convex) → local checks → build, simulate and sign (wallet) →
 * send → record the hash (Convex). Convex verification and the indexer
 * decide the outcome; this function never reports confirmation.
 *
 * Any failure before the transaction is sent is recorded on the
 * submission, so the author can try again at once.
 */
import { ConvexError } from 'convex/values'
import {
  ArticleCallError,
  articleContractCall,
  checkPreparedCall,
  type PreparedArticleCall,
} from './article-calls'
import type { V2ClientConfig } from './config'
import { sendContractCall, type RpcLike, type TxStep } from './tx'
import { walletErrorMessage, type WalletError } from './wallet-errors'

export type ArticleActionPhase =
  | 'preparing'
  | 'connecting'
  | TxStep
  | 'recording'

export type ArticleActionMessage = { title: string; detail: string }

export type ArticleActionResult =
  | { status: 'submitted'; txHash: string }
  | { status: 'cancelled' }
  | {
      status: 'failed'
      stage: 'prepare' | 'check' | 'wallet' | 'simulation' | 'send'
      message: ArticleActionMessage
      /** Server code or contract error name, for tests and copy. */
      code: string | null
    }

export type ArticleActionDeps = {
  convexArticleId: string
  config: Pick<V2ClientConfig, 'passphrase' | 'coreContractId'>
  server: RpcLike
  prepare: () => Promise<
    PreparedArticleCall & { submissionId: string; existing: boolean }
  >
  /**
   * Makes the wallet ready to sign as `signer`: connects it when needed and
   * returns its address, or null when the author closed the picker.
   */
  connect: (signer: string) => Promise<string | null>
  sign: (xdr: string, signer: string) => Promise<string>
  recordSubmitted: (submissionId: string, txHash: string) => Promise<void>
  recordFailed: (
    submissionId: string,
    reason: 'simulation_failed' | 'send_error' | 'wallet_rejected',
    detail?: string
  ) => Promise<void>
  onPhase?: (phase: ArticleActionPhase) => void
}

const SERVER_COPY: Record<string, ArticleActionMessage> = {
  NO_WALLET: {
    title: 'Connect a receiving wallet first',
    detail:
      'Tips go to a Stellar wallet you control. Connect one, then try again.',
  },
  WALLET_NOT_VERIFIED: {
    title: 'Verify your receiving wallet first',
    detail:
      'Sign the short verification message in your wallet, then try again.',
  },
  CHAIN_V2_DISABLED: {
    title: 'Tips on Stellar are not available yet',
    detail: 'This QuillTip deployment has not enabled them. Nothing was sent.',
  },
}

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function serverFailure(error: unknown): ArticleActionResult {
  if (
    error instanceof ConvexError &&
    error.data &&
    typeof error.data === 'object'
  ) {
    const data = error.data as { code?: string; message?: string }
    const code = data.code ?? 'SERVER'
    return {
      status: 'failed',
      stage: 'prepare',
      code,
      message: SERVER_COPY[code] ?? {
        title: 'QuillTip could not prepare this',
        detail: data.message ?? 'Try again in a moment. Nothing was sent.',
      },
    }
  }
  return {
    status: 'failed',
    stage: 'prepare',
    code: 'SERVER',
    message: {
      title: 'QuillTip could not prepare this',
      detail: 'Check your connection and try again. Nothing was sent.',
    },
  }
}

export async function runArticleAction(
  deps: ArticleActionDeps
): Promise<ArticleActionResult> {
  deps.onPhase?.('preparing')
  let prepared: Awaited<ReturnType<ArticleActionDeps['prepare']>>
  try {
    prepared = await deps.prepare()
  } catch (error) {
    return serverFailure(error)
  }
  const fail = async (
    result: Extract<ArticleActionResult, { status: 'failed' }>,
    reason: 'simulation_failed' | 'send_error' | 'wallet_rejected',
    detail?: string
  ): Promise<ArticleActionResult> => {
    // Best effort: an unrecorded failure expires after the time bound.
    await deps
      .recordFailed(prepared.submissionId, reason, detail)
      .catch(() => {})
    return result
  }

  try {
    checkPreparedCall(prepared, {
      convexArticleId: deps.convexArticleId,
      networkPassphrase: deps.config.passphrase,
      coreContractId: deps.config.coreContractId,
    })
  } catch (error) {
    const detail =
      error instanceof ArticleCallError ? error.message : 'Nothing was signed.'
    return fail(
      {
        status: 'failed',
        stage: 'check',
        code: 'CHECK',
        message: {
          title: 'This request does not match QuillTip’s settings',
          detail,
        },
      },
      'wallet_rejected',
      'client_check'
    )
  }

  deps.onPhase?.('connecting')
  let address: string | null
  try {
    address = await deps.connect(prepared.signer)
  } catch (error) {
    return fail(walletFailure(error as WalletError), 'wallet_rejected')
  }
  if (!address) {
    await deps
      .recordFailed(prepared.submissionId, 'wallet_rejected', 'cancelled')
      .catch(() => {})
    return { status: 'cancelled' }
  }
  if (address !== prepared.signer) {
    return fail(
      {
        status: 'failed',
        stage: 'wallet',
        code: 'WRONG_ACCOUNT',
        message: {
          title: `Switch your wallet to ${shorten(prepared.signer)}`,
          detail: `${
            prepared.kind === 'author_propose'
              ? 'The wallet this article is registered to'
              : 'Your receiving wallet'
          } must sign this. Your wallet is on ${shorten(address)}. Nothing was signed.`,
        },
      },
      'wallet_rejected',
      'wrong_account'
    )
  }

  const outcome = await sendContractCall(
    {
      server: deps.server,
      sign: (xdr) => deps.sign(xdr, prepared.signer),
      onStep: deps.onPhase,
    },
    articleContractCall(prepared)
  )
  switch (outcome.status) {
    case 'sent':
      deps.onPhase?.('recording')
      try {
        await deps.recordSubmitted(prepared.submissionId, outcome.hash)
      } catch {
        // The indexer still confirms it from the event (rule (b)).
      }
      return { status: 'submitted', txHash: outcome.hash }
    case 'wallet_failed':
      if (outcome.error.kind === 'cancelled') {
        await deps
          .recordFailed(prepared.submissionId, 'wallet_rejected', 'cancelled')
          .catch(() => {})
        return { status: 'cancelled' }
      }
      return fail(
        walletFailure(outcome.error),
        'wallet_rejected',
        outcome.error.kind
      )
    case 'simulation_failed':
      return fail(
        {
          status: 'failed',
          stage: 'simulation',
          code: outcome.error.name,
          message: {
            title: 'Stellar would refuse this',
            detail: `${outcome.error.message} Nothing was signed.`,
          },
        },
        'simulation_failed',
        outcome.error.name ?? undefined
      )
    case 'send_error':
      return fail(
        {
          status: 'failed',
          stage: 'send',
          code: outcome.detail,
          message: {
            title: 'Stellar did not accept the transaction',
            detail: `${outcome.error.message}`,
          },
        },
        'send_error',
        outcome.detail
      )
    case 'not_sent':
      return fail(
        {
          status: 'failed',
          stage: 'send',
          code: 'TRY_AGAIN_LATER',
          message: {
            title: 'The Stellar network is busy',
            detail: 'Nothing was sent. Try again in a minute.',
          },
        },
        'send_error',
        'TRY_AGAIN_LATER'
      )
  }
}

function walletFailure(
  error: WalletError
): Extract<ArticleActionResult, { status: 'failed' }> {
  const message = walletErrorMessage(error) ?? {
    title: 'Your wallet reported a problem',
    detail: 'Try again, or reconnect your wallet.',
  }
  return { status: 'failed', stage: 'wallet', code: error.kind, message }
}
