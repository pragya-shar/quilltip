/**
 * Keys live in a Stellar CLI config directory outside the repository, one per
 * set. Secret files are mode 600. The tool never prints a secret: it reads one
 * only to sign voucher payloads, in memory.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve, isAbsolute } from 'path'
import { execFileSync } from 'child_process'
import { Keypair, StrKey } from '@stellar/stellar-sdk'

import { identityName, type ContractSet } from './config'
import { cli, cliOffline, confirmNetwork, type CliContext } from './network'

/** Refuses a key directory inside the git work tree. */
export function assertKeysDirOutsideRepo(
  keysDir: string,
  cwd = process.cwd()
): string {
  const absolute = resolve(keysDir)
  let top = ''
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
    }).trim()
  } catch {
    top = ''
  }
  if (top) {
    const rel = relative(resolve(top), absolute)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      throw new Error(
        `The key directory ${absolute} is inside the repository. Keep keys outside it.`
      )
    }
  }
  return absolute
}

/** Directory and file modes: 700 for directories, 600 for identity files. */
export function restrictKeyFiles(configDir: string): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  chmodSync(configDir, 0o700)
  const identityDir = join(configDir, 'identity')
  if (!existsSync(identityDir)) return
  chmodSync(identityDir, 0o700)
  for (const file of readdirSync(identityDir)) {
    const path = join(identityDir, file)
    if (statSync(path).isFile()) chmodSync(path, 0o600)
  }
}

function identityExists(ctx: CliContext, name: string): boolean {
  return existsSync(join(ctx.configDir, 'identity', `${name}.toml`))
}

/** Public key of an identity, as a G address. */
export function address(ctx: CliContext, name: string): string {
  return cliOffline(ctx, ['keys', 'address', name])
}

/**
 * Creates the identity if it is missing, then funds it with Friendbot when
 * `fund` is set. Funding an account that already exists is a no-op.
 */
export async function ensureKey(
  ctx: CliContext,
  set: ContractSet,
  key: string,
  fund: boolean
): Promise<string> {
  const name = identityName(set, key)
  if (!identityExists(ctx, name)) {
    cli(ctx, ['keys', 'generate', name])
    restrictKeyFiles(ctx.configDir)
  }
  const pub = address(ctx, name)
  if (fund && !(await accountExists(ctx, pub))) {
    await confirmNetwork(ctx.net)
    cli(ctx, ['keys', 'fund', name])
  }
  return pub
}

async function accountExists(
  ctx: CliContext,
  account: string
): Promise<boolean> {
  const { xdr } = await import('@stellar/stellar-sdk')
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(account).xdrAccountId(),
    })
  ).toXDR('base64')
  const response = await fetch(ctx.net.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLedgerEntries',
      params: { keys: [key] },
    }),
  })
  const body = (await response.json()) as { result?: { entries?: unknown[] } }
  return (body.result?.entries?.length ?? 0) > 0
}

/** The 32 raw bytes of an ed25519 public key, as hex (Soroban BytesN<32>). */
export function rawPublicKeyHex(gAddress: string): string {
  return Buffer.from(StrKey.decodeEd25519PublicKey(gAddress)).toString('hex')
}

/** Signing key of an identity, read into memory only. */
export function signer(ctx: CliContext, name: string): Keypair {
  const secret = cliOffline(ctx, ['keys', 'show', name])
  return Keypair.fromSecret(secret)
}
