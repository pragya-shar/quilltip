/**
 * Names of the tip send buttons (#645): the dollar amount as the app shows
 * it ("$1", "$12.50"), then "tip". Before the amount is valid the button reads
 * "Send tip". Exact patterns, so a test also fails on wording drift.
 */
const DOLLARS = String.raw`\$\d[\d,]*(?:\.\d\d)?`

/** The tip dialog and the passage tip: "Send $1 tip", "Send $12.50 tip". */
export const SEND_TIP = new RegExp(`^Send ${DOLLARS} tip$`)

/** The wallet button while a tab can send: "Send $1 tip from your wallet". */
export const SEND_TIP_FROM_WALLET = new RegExp(
  `^Send ${DOLLARS} tip from your wallet$`
)

/** The basket: "Send $2.25 in 2 tips". */
export const sendBasket = (count: number) =>
  new RegExp(`^Send ${DOLLARS} in ${count} ${count === 1 ? 'tip' : 'tips'}$`)
