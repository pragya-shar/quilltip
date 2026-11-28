/**
 * The most a request in these sheets lets the network ask as a fee: 1 XLM.
 * A deposit with a device approval writes the balance, the approval and
 * their rent; on Stellar testnet that costs a small part of an XLM. The
 * ceiling bounds what a misbehaving network server could ask before the
 * wallet is asked.
 */
export const FEE_CEILING_STROOPS = BigInt(10_000_000)
