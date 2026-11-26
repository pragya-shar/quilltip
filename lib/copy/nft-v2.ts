/**
 * Copy for the v2 article NFT (mint at the threshold and transfer).
 * Shared states (progress steps, results, wallet gate, paused) come from the
 * payment kit (`lib/copy/payment-states.ts`); this file holds only what is
 * specific to the NFT. Testnet is named wherever a token or a transaction
 * appears.
 */

export type NftCopy = { title: string; detail: string }

export const NFT_WALLET_PAGE = '/dashboard/wallet'

export const NFT_COPY = {
  sectionTitle: 'Article NFT',
  /** Under the progress figures, always: the total counts direct tips only. */
  directTipsOnly: 'Counts tips sent from a wallet. Tab tips don’t count.',
  progressLabel: 'Tips toward the NFT',
  reachedReader: 'This article has reached the mint threshold.',
  checkAgain: 'Check again',
  mintAction: 'Mint article NFT',
  mintHint:
    'Mints one NFT for this article to your wallet on Stellar testnet. You pay only the network fee.',
  token: 'Token',
  owner: 'Owner',
  you: 'You',
  ownerOutside: 'A wallet outside QuillTip',
  viewToken: 'View the token on Stellar Expert',
  updatingOwner: 'Updating the owner',
  updatingOwnerDetail:
    'Stellar testnet confirmed it. The owner shown here updates in a moment.',
  transferAction: 'Transfer NFT',
  v1Label: 'v1 record',
  v1Detail:
    'An earlier testnet version recorded this NFT. It is kept for reference and can’t be transferred here.',
  notRegistered:
    'NFTs unlock from tips on Stellar testnet. Tips aren’t on for this article yet.',
  notRegisteredAuthor:
    'Turn on tips for this article first. The NFT unlocks from tips on Stellar testnet.',
  unavailable: 'The NFT status can’t be read right now. Try again in a minute.',
  rateLimited: 'Too many checks in a row. Try again in a minute.',
} as const

/** Author-only eligibility states with their own message (`getMintEligibility`). */
export const ELIGIBILITY_COPY: Partial<Record<string, NftCopy>> = {
  NO_WALLET: {
    title: 'Link a wallet to mint',
    detail:
      'The NFT goes to the Stellar wallet that receives this article’s tips. Link it to your account first.',
  },
  WALLET_NOT_VERIFIED: {
    title: 'Confirm your wallet to mint',
    detail:
      'Sign a short message to link your wallet to your account. It sends nothing and costs nothing.',
  },
  AUTHOR_ADDRESS_MISMATCH: {
    title: 'Use the wallet that receives this article’s tips',
    detail:
      'Only the wallet registered for this article can mint its NFT. Your account’s wallet is a different one.',
  },
  PAUSED: {
    title: 'Minting is paused',
    detail:
      'QuillTip has paused new mints and transfers on Stellar testnet. Your progress is kept.',
  },
}

/** `ConvexError` codes from `prepareMint` and `prepareTransfer`. */
export const PREPARE_REFUSALS: Record<string, NftCopy> = {
  CHAIN_V2_DISABLED: {
    title: 'Article NFTs aren’t on yet',
    detail: 'This QuillTip site hasn’t turned them on. Nothing was sent.',
  },
  CHAIN_CONFIG_MISSING: {
    title: 'Article NFTs aren’t set up on this site',
    detail: 'Nothing was sent. Try again later.',
  },
  UNAUTHENTICATED: {
    title: 'Sign in to continue',
    detail: 'Your session ended. Sign in, then try again. Nothing was sent.',
  },
  NOT_FOUND: {
    title: 'This NFT or article isn’t available',
    detail: 'It may have been unpublished. Nothing was sent.',
  },
  NOT_PUBLISHED: {
    title: 'Publish the article first',
    detail: 'Only published articles can have an NFT. Nothing was sent.',
  },
  NOT_REGISTERED: {
    title: 'Tips aren’t on for this article yet',
    detail: NFT_COPY.notRegisteredAuthor + ' Nothing was sent.',
  },
  NO_WALLET: ELIGIBILITY_COPY.NO_WALLET!,
  WALLET_NOT_VERIFIED: ELIGIBILITY_COPY.WALLET_NOT_VERIFIED!,
  NOT_ONCHAIN_AUTHOR: ELIGIBILITY_COPY.AUTHOR_ADDRESS_MISMATCH!,
  ALREADY_MINTED: {
    title: 'This article’s NFT is already minted',
    detail: 'Each article has one NFT. Nothing was sent.',
  },
  NOT_OWNER: {
    title: 'Your wallet doesn’t own this NFT',
    detail:
      'It may have moved to another wallet. The owner shown here is current. Nothing was sent.',
  },
  NOT_V2_NFT: {
    title: 'This NFT can’t be transferred here',
    detail: NFT_COPY.v1Detail,
  },
  INVALID_RECIPIENT: {
    title: 'That recipient can’t hold the NFT',
    detail:
      'Enter a Stellar account (G…) or a contract that can hold NFTs. Nothing was sent.',
  },
  RECIPIENT_NOT_FOUND: {
    title: 'No QuillTip writer or reader has that username',
    detail:
      'Check the spelling, or enter their Stellar address. Nothing was sent.',
  },
  RECIPIENT_NO_WALLET: {
    title: 'That person has no confirmed wallet',
    detail:
      'They need to link and confirm a Stellar wallet first, or you can enter an address. Nothing was sent.',
  },
  SELF_TRANSFER: {
    title: 'This NFT is already in that wallet',
    detail: 'Choose another recipient. Nothing was sent.',
  },
  PENDING: {
    title: 'A request for this NFT is still in progress',
    detail:
      'Its progress shows here. Wait for it to finish before starting another.',
  },
  RATE_LIMITED: {
    title: 'Too many requests in a row',
    detail: 'Wait a minute, then try again. Nothing was sent.',
  },
  INVALID_PREPARE: {
    title: 'QuillTip couldn’t prepare this',
    detail: 'Refresh the page and try again. Nothing was sent.',
  },
}

export const PREPARE_REFUSAL_FALLBACK: NftCopy = {
  title: 'QuillTip couldn’t prepare this',
  detail: 'Check your connection and try again. Nothing was sent.',
}

/** Shown when the local check refuses what the server prepared. */
export const CHECK_FAILED_TITLE =
  'This request doesn’t match what you confirmed'

export const TRANSFER_COPY = {
  dialogTitle: 'Transfer this NFT',
  dialogDescription:
    'Send the article NFT to another Stellar wallet. The royalty stays with the writer who minted it.',
  recipientLabel: 'Recipient',
  recipientHint:
    'A Stellar address (G… or C…) or a QuillTip username such as @ada.',
  review: 'Review transfer',
  reviewTitle: 'Check the recipient',
  reviewLead: 'You’re sending',
  reviewTo: 'To',
  reviewUser: (username: string) => `QuillTip account @${username}`,
  reviewAddressHelp:
    'Compare every group with the address you were given, not only the first and last.',
  contractWarning:
    'This is a contract address. Send the NFT only if you know this contract can hold and move NFTs.',
  irreversible:
    'A transfer can’t be undone. Only the new owner can send the NFT back.',
  confirm: 'Transfer NFT',
  back: 'Change recipient',
  cancel: 'Cancel',
  copy: 'Copy address',
  copied: 'Address copied',
  refreshed:
    'The review timed out, so QuillTip prepared it again. Check the address once more.',
  close: 'Close',
} as const
