/**
 * The v2 client runtime: validated configuration and an RPC client for it.
 * One seam, so fixture pages can supply an offline stand-in.
 */
import { rpc } from '@stellar/stellar-sdk'
import { v2Config, type V2ClientConfig } from './config'
import type { RpcLike } from './tx'

export type V2Runtime = {
  config: V2ClientConfig
  server: RpcLike
  /** The latest ledger RPC knows, for ledger-based expiries. */
  latestLedger: () => Promise<number>
}

let runtime: V2Runtime | null = null

export function v2Runtime(): V2Runtime {
  if (!runtime) {
    const config = v2Config()
    const server = new rpc.Server(config.rpcUrl, {
      allowHttp: config.allowHttp,
    })
    runtime = {
      config,
      server,
      latestLedger: async () => (await server.getLatestLedger()).sequence,
    }
  }
  return runtime
}
