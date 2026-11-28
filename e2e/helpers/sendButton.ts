/**
 * Names of the tip send buttons (#645): the dollar amount as the app shows
 * it ("$1", "$12.50"), then "tip". Before the amount is valid the button reads
 * "Send tip". Exact patterns, so a test also fails on wording drift.
 *
 * One number form for every send button (#676), the form of `formatCents`:
 * whole dollars carry no cents ("$1", never "$1.00").
 */
const DOLLARS = String.raw`\$\d{1,3}(?:,\d{3})*(?:\.(?!00)\d\d)?`

/** The tip dialog and the passage tip: "Send $1 tip", "Send $12.50 tip". */
export const SEND_TIP = new RegExp(`^Send ${DOLLARS} tip$`)

/** The wallet button while a tab can send: "Send $1 tip from your wallet". */
export const SEND_TIP_FROM_WALLET = new RegExp(
  `^Send ${DOLLARS} tip from your wallet$`
)

/** The tab section's button: "Send $1 from your tab" (#676). */
export const SEND_FROM_TAB = new RegExp(`^Send ${DOLLARS} from your tab$`)

/** The basket: "Send $2.25 in 2 tips". */
export const sendBasket = (count: number) =>
  new RegExp(`^Send ${DOLLARS} in ${count} ${count === 1 ? 'tip' : 'tips'}$`)
