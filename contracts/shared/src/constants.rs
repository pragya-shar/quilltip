//! Constants shared by more than one contract or by off-chain encoders.

/// Ledgers per day at the 5-second target close time.
pub const DAY: u32 = 17_280;

/// Extend an entry when its remaining TTL falls below this many ledgers.
pub const TTL_THRESHOLD: u32 = 30 * DAY;

/// Extend an entry so that it lives this many ledgers from now.
pub const TTL_EXTEND_TO: u32 = 120 * DAY;

/// Platform fee in basis points (2.5%). Writers receive the remaining 97.5%.
pub const FEE_BPS: u32 = 250;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u32 = 10_000;

/// Smallest gross amount whose fee is at least 1 base unit (`40 * 250 / 10_000 == 1`).
pub const MIN_FEE_BEARING_AMOUNT: i128 = 40;

/// Tab voucher signing domain (`Symbol`).
pub const TAB_DOMAIN: &str = "quilltip_tab_v1";

/// Tab acceptance countersignature domain (`Symbol`).
pub const TAB_ACCEPT_DOMAIN: &str = "quilltip_tab_accept_v1";

/// Maximum receipts anchored by one `(reader, key_id, writer)` voucher chain.
pub const MAX_RECEIPTS_PER_PAIR: u32 = 256;

/// Prefix of the article identifier preimage.
pub const ARTICLE_ID_PREFIX: &str = "quilltip:article:v1:";

/// Value for the `source_repo` contract metadata entry.
pub const SOURCE_REPO: &str = "github:pragya-shar/QuillTip";
