use soroban_sdk::contracterror;

/// `NftError`, codes 70 to 89 (`docs/architecture/v2/04-nft-contract.md`, section 4.4).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum NftError {
    /// The Core total for the threshold token is below the threshold.
    BelowThreshold = 70,
    /// The article already has an NFT.
    AlreadyMinted = 71,
    /// The threshold is not greater than zero.
    InvalidThreshold = 72,
    /// The stored schema version is not below the target version.
    AlreadyMigrated = 73,
    /// No article is recorded for the token ID.
    UnknownToken = 74,
    /// Royalties are fixed at mint.
    RoyaltyImmutable = 75,
    /// The admin role cannot be renounced.
    AdminRenounceDisabled = 76,
}
