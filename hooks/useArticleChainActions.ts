'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useWallet } from '@/components/providers/WalletProvider'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import { v2Runtime } from '@/lib/stellar/v2/chain-runtime'
import {
  runArticleAction,
  type ArticleActionMessage,
  type ArticleActionPhase,
} from '@/lib/stellar/v2/article-actions'
import type { Split } from '@/convex/lib/chain/splits'

export type ArticleAction =
  | 'register'
  | 'content_update'
  | 'author_propose'
  | 'author_accept'

export type ArticleActionFailure = {
  action: ArticleAction
  message: ArticleActionMessage
  code: string | null
}

function requestId(): string {
  return crypto.randomUUID()
}

/**
 * Registration state of one article and the actions that change it on Core:
 * enable tips, update the content anchor, and the two-step move to a new
 * wallet. One action runs at a time.
 */
export function useArticleChainActions(articleId: Id<'articles'>) {
  const registration = useQuery(api.chain.articles.getRegistration, {
    articleId,
  })
  const prepareRegistration = useMutation(
    api.chain.articles.prepareRegistration
  )
  const prepareContentUpdate = useMutation(
    api.chain.articles.prepareContentUpdate
  )
  const prepareAuthorProposal = useMutation(
    api.chain.articles.prepareAuthorProposal
  )
  const prepareAuthorAccept = useMutation(
    api.chain.articles.prepareAuthorAccept
  )
  const recordSubmitted = useMutation(api.chain.submissions.recordSubmitted)
  const recordSendFailed = useMutation(api.chain.submissions.recordSendFailed)
  // Load the wallet runtime only where v2 actions can run.
  const walletContext = useWallet({
    activateOnMount: registration?.v2Enabled === true,
  })
  const walletRef = useRef(walletContext)
  walletRef.current = walletContext

  const [running, setRunning] = useState<ArticleAction | null>(null)
  const [phase, setPhase] = useState<ArticleActionPhase | null>(null)
  const [failure, setFailure] = useState<ArticleActionFailure | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async (action: ArticleAction, opts: { splits?: Split[] } = {}) => {
      if (running) return null
      setRunning(action)
      setFailure(null)
      let runtime
      try {
        runtime = v2Runtime()
      } catch (error) {
        // The message names environment variables: log it, do not show it.
        console.error('[tips] payments v2 is not configured', error)
        setRunning(null)
        setFailure({
          action,
          code: 'CONFIG',
          message: {
            title: 'Tips on Stellar testnet are not set up on this site',
            // The raw error names environment variables; keep it out of the UI.
            detail: 'Nothing was sent. Try again later.',
          },
        })
        return null
      }
      const prepare = async () => {
        const id = requestId()
        switch (action) {
          case 'register':
            return prepareRegistration({
              articleId,
              requestId: id,
              ...(opts.splits && opts.splits.length > 0
                ? { splits: opts.splits }
                : {}),
            })
          case 'content_update':
            return prepareContentUpdate({ articleId, requestId: id })
          case 'author_propose':
            return prepareAuthorProposal({
              articleId,
              requestId: id,
              currentLedger: await runtime.latestLedger(),
            })
          case 'author_accept':
            return prepareAuthorAccept({ articleId, requestId: id })
        }
      }
      const result = await runArticleAction({
        convexArticleId: articleId,
        config: runtime.config,
        server: runtime.server,
        prepare,
        connect: async () => {
          const current = wallet.getConnection()
          if (current) return current.address
          // The runtime may still be loading; its connect opens the picker.
          for (let i = 0; i < 50 && walletRef.current.isLoading; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const connected = await walletRef.current.connect()
          return connected ? (wallet.getConnection()?.address ?? null) : null
        },
        sign: async (xdr, signer) =>
          (await wallet.signTransaction(xdr, { address: signer })).signedTxXdr,
        recordSubmitted: async (submissionId, txHash) => {
          await recordSubmitted({
            submissionId: submissionId as Id<'chainSubmissions'>,
            txHash,
          })
        },
        recordFailed: async (submissionId, reason, detail) => {
          await recordSendFailed({
            submissionId: submissionId as Id<'chainSubmissions'>,
            reason,
            ...(detail ? { detail } : {}),
          })
        },
        onPhase: (next) => {
          if (mounted.current) setPhase(next)
        },
      })
      if (mounted.current) {
        setRunning(null)
        setPhase(null)
        if (result.status === 'failed') {
          setFailure({ action, message: result.message, code: result.code })
        }
      }
      return result
    },
    [
      articleId,
      prepareAuthorAccept,
      prepareAuthorProposal,
      prepareContentUpdate,
      prepareRegistration,
      recordSendFailed,
      recordSubmitted,
      running,
    ]
  )

  const dismissFailure = useCallback(() => setFailure(null), [])

  return {
    registration,
    running,
    phase,
    failure,
    run,
    dismissFailure,
  }
}
