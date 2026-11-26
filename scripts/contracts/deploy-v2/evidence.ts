/**
 * Writes the deployment evidence (section 8.4, step 9): one Markdown section
 * per contract set, built only from the public state. No secret is read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import {
  CONTRACTS,
  CORE_MIN_TIP,
  NFT_THRESHOLD,
  ROLE_KEYS,
  SMOKE_KEYS,
  TAB_MAX_BALANCE,
  TAB_MIN_DEPOSIT,
  WASM_FILES,
} from './config'
import { explorerContract, explorerTx, type DeployNetwork } from './network'
import type { DeployState } from './state'

const xlm = (stroops: bigint | string) =>
  `${(Number(stroops) / 1e7).toLocaleString('en-US', { maximumFractionDigits: 7 })} XLM`

function txCell(net: DeployNetwork, hash: string | undefined | null): string {
  if (!hash) return 'not recorded'
  const link = explorerTx(net, hash)
  return link ? `[\`${hash.slice(0, 12)}…\`](${link})` : `\`${hash}\``
}

function header(net: DeployNetwork): string {
  const where =
    net.network === 'TESTNET'
      ? 'the **Stellar testnet**. Testnet XLM has no monetary value'
      : 'a **local standalone Stellar network** (a rehearsal, not testnet)'
  return `# Payments v2 contract deployments (${net.network === 'TESTNET' ? 'testnet' : 'local network'})

QuillTip payments v2 contracts deployed to ${where}, by
\`scripts/contracts/deploy-v2-testnet.ts\`
(docs/architecture/v2/08-testing-and-deployment.md, section 8.4). Each contract
set has its own keys and contracts. This file contains no secrets.
`
}

export function sectionMarkers(set: string) {
  return {
    start: `<!-- contract-set:${set}:start -->`,
    end: `<!-- contract-set:${set}:end -->`,
  }
}

export function renderSection(
  state: DeployState,
  net: DeployNetwork,
  toolVersions: Record<string, string>
): string {
  const b = state.build!
  const c = state.contracts ?? {}
  const k = state.keys ?? {}
  const indexerStart = c.core?.tx?.ledger
  const lines: string[] = []
  lines.push(`## Contract set: ${state.set}`, '')
  lines.push(
    `- Network: Stellar ${state.network === 'TESTNET' ? 'testnet' : 'local standalone network'} (\`${state.passphrase}\`)`
  )
  lines.push(`- Commit: \`${b.commit}\``)
  for (const [tool, version] of Object.entries(toolVersions))
    lines.push(`- ${tool}: ${version}`)
  lines.push(
    `- Build image: \`${b.image}\`; Wasm built twice with identical hashes: ${b.reproduced ? 'yes' : 'no'}`
  )
  lines.push(
    `- \`INDEXER_START_LEDGER\`: ${indexerStart ?? 'not recorded'} (the Core deployment ledger)`,
    ''
  )

  lines.push('### Contracts', '')
  lines.push(
    '| Contract | ID | Wasm | Wasm SHA-256 | Bytes | Upload tx | Deploy and constructor tx | Ledger |'
  )
  lines.push('| --- | --- | --- | --- | --: | --- | --- | --: |')
  for (const name of CONTRACTS) {
    const rec = c[name]
    const link = rec ? explorerContract(net, rec.id) : null
    lines.push(
      `| ${name} | ${rec ? (link ? `[\`${rec.id}\`](${link})` : `\`${rec.id}\``) : 'not deployed'} | \`${WASM_FILES[name]}\` | \`${b.wasm[name].sha256}\` | ${b.wasm[name].bytes} | ${txCell(net, state.uploads?.[name]?.tx?.hash)} | ${txCell(net, rec?.tx?.hash)} | ${rec?.tx?.ledger ?? ''} |`
    )
  }
  lines.push('')

  lines.push('### Keys (public)', '')
  lines.push('| Role | Public key |', '| --- | --- |')
  for (const role of ROLE_KEYS) lines.push(`| ${role} | \`${k[role] ?? ''}\` |`)
  lines.push(
    '',
    'The acceptor key is registered in the Tab as raw ed25519 bytes; it is never funded.',
    ''
  )

  lines.push('### Configuration', '')
  lines.push(
    `- Token: native XLM Stellar Asset Contract \`${state.nativeSac}\``
  )
  lines.push(
    `- Core \`min_tip\`: ${CORE_MIN_TIP} stroops (${xlm(CORE_MIN_TIP)}); fee 250 bps`
  )
  lines.push(
    `- Tab \`max_balance\`: ${TAB_MAX_BALANCE} stroops (${xlm(TAB_MAX_BALANCE)}); \`min_deposit\`: ${TAB_MIN_DEPOSIT} stroops (${xlm(TAB_MIN_DEPOSIT)})`
  )
  lines.push(
    `- NFT threshold: ${NFT_THRESHOLD} stroops (${xlm(NFT_THRESHOLD)}) of XLM; \`base_uri\`: \`${state.config?.nftBaseUri ?? ''}\``
  )
  lines.push('')

  if (state.verify) {
    const ok = state.verify.checks.filter((x) => x.ok).length
    lines.push('### Read-back', '')
    lines.push(
      `${ok} of ${state.verify.checks.length} checks match (${state.verify.at}).`,
      ''
    )
    lines.push(
      '| Check | Expected | On chain | Match |',
      '| --- | --- | --- | --- |'
    )
    for (const x of state.verify.checks) {
      lines.push(
        `| ${x.name} | \`${x.expected}\` | \`${x.actual}\` | ${x.ok ? 'yes' : '**no**'} |`
      )
    }
    lines.push('')
  }

  if (state.smoke && Object.keys(state.smoke).length > 0) {
    lines.push('### Smoke transactions', '')
    lines.push(
      `Throwaway test accounts: ${SMOKE_KEYS.filter((x) => x !== 'session')
        .map((x) => `${x} \`${k[`smoke-${x}`]}\``)
        .join(', ')}.`,
      ''
    )
    lines.push(
      '| Flow | What it did | Transaction | Ledger | Fee charged |',
      '| --- | --- | --- | --: | --: |'
    )
    for (const rec of Object.values(state.smoke)) {
      lines.push(
        `| ${rec.flow} | ${rec.detail} | ${rec.tx ? txCell(net, rec.tx.hash) : 'off chain'} | ${rec.tx?.ledger ?? ''} | ${rec.tx ? `${rec.tx.feeCharged} stroops` : ''} |`
      )
    }
    if (state.smokeData?.readback)
      lines.push(
        '',
        `Read-back after the flows: \`${state.smokeData.readback}\``
      )
    lines.push('')
  }
  if (state.convexEnv) {
    lines.push('### Integration Convex deployment', '')
    lines.push(
      `On ${state.convexEnv.at}, these variables were set on the integration Convex deployment (values for public IDs are listed above; secrets are not recorded): ${state.convexEnv.names.map((n) => `\`${n}\``).join(', ')}. \`CHAIN_V2_ENABLED\` and \`SETTLEMENT_ENABLED\` were left unchanged.`
    )
    lines.push('')
  }
  return lines.join('\n')
}

/** Replaces this set's section in the evidence file, keeping other sets. */
export function writeEvidence(
  path: string,
  state: DeployState,
  net: DeployNetwork,
  toolVersions: Record<string, string>
): void {
  const { start, end } = sectionMarkers(state.set)
  const section = `${start}\n\n${renderSection(state, net, toolVersions)}\n${end}`
  let doc = existsSync(path) ? readFileSync(path, 'utf8') : `${header(net)}\n`
  const from = doc.indexOf(start)
  const to = doc.indexOf(end)
  doc =
    from !== -1 && to > from
      ? `${doc.slice(0, from)}${section}${doc.slice(to + end.length)}`
      : `${doc.trimEnd()}\n\n${section}\n`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, doc)
}
