/**
 * Prints the measurements of a local-network run as Markdown.
 *
 *   bun scripts/integration/summary.ts <dir with measurements.json>
 */
import { readFileSync } from 'fs'
import { join } from 'path'

type Row = {
  label: string
  feeCharged: string
  resourceFee: string
  rentCharged: string
  instructions: number
  writeBytes: number
  readWriteEntries: number
  readOnlyEntries: number
  eventBytes: number
}

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: bun scripts/integration/summary.ts <dir>')
  process.exit(2)
}
const { measured, reduction } = JSON.parse(
  readFileSync(join(dir, 'measurements.json'), 'utf8')
) as {
  measured: Row[]
  reduction: Record<string, unknown>
}
const pick =
  /^(tip|tip_highlight|tip_split|tip_batch_10|register_article|open_session|settle_1|settle_own_1|claim|settle_n\d+(_warm)?|direct_tip_1|settle_own_n32|nft_mint|nft_transfer|core_upgrade|core_migrate|withdraw_start)$/
const seen = new Set<string>()
const xlm = (stroops: string) => (Number(stroops) / 1e7).toFixed(7)
console.log(
  '| Transaction | Fee charged (stroops) | Fee (XLM) | Rent (stroops) | Instructions | Write bytes | RW / RO entries | Event bytes |'
)
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const m of measured) {
  if (!pick.test(m.label) || seen.has(m.label)) continue
  seen.add(m.label)
  console.log(
    `| ${m.label} | ${m.feeCharged} | ${xlm(m.feeCharged)} | ${m.rentCharged} | ${m.instructions.toLocaleString('en-US')} | ${m.writeBytes} | ${m.readWriteEntries} / ${m.readOnlyEntries} | ${m.eventBytes} |`
  )
}
console.log('')
console.log('Tab flow against direct tips:')
console.log('')
console.log('```json')
console.log(JSON.stringify(reduction, null, 2))
console.log('```')
