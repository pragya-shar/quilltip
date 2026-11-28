/**
 * Core article calls from a Convex prepare result
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.1). Arguments are
 * encoded with the generated Core bindings' contract spec.
 *
 * Before anything is signed, the client checks the prepared values against
 * its own configuration and recomputes `article_id` with the shared encoder,
 * so a wrong network, contract or article ID is refused locally.
 */
import { StrKey, type xdr } from '@stellar/stellar-sdk'
import { Client as CoreClient } from './bindings/core'
import { articleId, articleRef } from './ids'
import { bytesToHex } from '../bytes'
import type { ContractCall } from './tx'

export type ArticleCallKind =
  | 'register'
  | 'content_update'
  | 'author_propose'
  | 'author_accept'

/** The fields of `chain.articles.prepare*` results that the call uses. */
export type PreparedArticleCall = {
  kind: ArticleCallKind
  contractId: string
  networkPassphrase: string
  maxTime: number
  signer: string
  articleKey: string
  articleRef: string | null
  author: string | null
  contentHash: string | null
  arweaveId: string | null
  splits: Array<{ recipient: string; bps: number }>
  newAuthor: string | null
  liveUntilLedger: number | null
}

const METHOD: Record<ArticleCallKind, string> = {
  register: 'register_article',
  content_update: 'update_content',
  author_propose: 'propose_author',
  author_accept: 'accept_author',
}

export class ArticleCallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArticleCallError'
  }
}

function bytes(hex: string | null, length: number, field: string): Uint8Array {
  if (!hex || hex.length !== length * 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw new ArticleCallError(`${field} must be ${length} bytes of hex`)
  }
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

const toHex = bytesToHex

let spec: CoreClient['spec'] | null = null
function coreSpec(contractId: string, networkPassphrase: string) {
  // The spec is the same for every Core instance; no network is contacted.
  spec ??= new CoreClient({
    contractId,
    networkPassphrase,
    // Required by the constructor; the spec is read without a request.
    rpcUrl: 'http://localhost',
    allowHttp: true,
  }).spec
  return spec
}

/**
 * Checks a prepared call against the client's configuration and the shared
 * article encoders. `convexArticleId` is the article's Convex `_id`.
 */
export function checkPreparedCall(
  prepared: PreparedArticleCall,
  expected: {
    convexArticleId: string
    networkPassphrase: string
    coreContractId: string | null
  }
): void {
  if (prepared.networkPassphrase !== expected.networkPassphrase) {
    throw new ArticleCallError(
      'The server prepared this for another network. Nothing was signed.'
    )
  }
  if (
    !expected.coreContractId ||
    prepared.contractId !== expected.coreContractId
  ) {
    throw new ArticleCallError(
      'The server prepared this for another contract. Nothing was signed.'
    )
  }
  if (!StrKey.isValidEd25519PublicKey(prepared.signer)) {
    throw new ArticleCallError('The signing address is not valid.')
  }
  if (prepared.kind === 'register') {
    const ref = toHex(articleRef(expected.convexArticleId))
    if (prepared.articleRef !== ref) {
      throw new ArticleCallError('The article reference does not match.')
    }
    const id = toHex(
      articleId(prepared.signer, articleRef(expected.convexArticleId))
    )
    if (prepared.articleKey !== id || prepared.author !== prepared.signer) {
      throw new ArticleCallError('The article ID does not match your wallet.')
    }
  }
}

/** The Core invocation for a prepared article call. */
export function articleContractCall(
  prepared: PreparedArticleCall
): ContractCall {
  const method = METHOD[prepared.kind]
  const id = bytes(prepared.articleKey, 32, 'article_id')
  const arweave = prepared.arweaveId
    ? bytes(prepared.arweaveId, 32, 'arweave_id')
    : null
  let args: Record<string, unknown>
  switch (prepared.kind) {
    case 'register':
      args = {
        author: prepared.signer,
        article_ref: bytes(prepared.articleRef, 32, 'article_ref'),
        content_hash: bytes(prepared.contentHash, 32, 'content_hash'),
        arweave_id: arweave,
        splits: prepared.splits.map((s) => ({
          recipient: s.recipient,
          bps: s.bps,
        })),
      }
      break
    case 'content_update':
      args = {
        article_id: id,
        content_hash: bytes(prepared.contentHash, 32, 'content_hash'),
        arweave_id: arweave,
      }
      break
    case 'author_propose':
      if (!prepared.newAuthor || !prepared.liveUntilLedger) {
        throw new ArticleCallError('The proposal is incomplete.')
      }
      args = {
        article_id: id,
        new_author: prepared.newAuthor,
        live_until_ledger: prepared.liveUntilLedger,
      }
      break
    case 'author_accept':
      args = { article_id: id }
      break
  }
  const scArgs: xdr.ScVal[] = coreSpec(
    prepared.contractId,
    prepared.networkPassphrase
  ).funcArgsToScVals(method, args)
  return {
    contractId: prepared.contractId,
    method,
    args: scArgs,
    source: prepared.signer,
    maxTime: prepared.maxTime,
    networkPassphrase: prepared.networkPassphrase,
  }
}
