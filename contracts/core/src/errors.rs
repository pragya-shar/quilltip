use soroban_sdk::contracterror;

/// Core errors, codes 1 to 29 (`02-core-contract.md`, section 2.5).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CoreError {
    NotRegistered = 1,
    AlreadyRegistered = 2,
    InvalidHash = 3,
    InvalidSplits = 4,
    TooManyRecipients = 5,
    TokenNotAllowed = 6,
    InvalidAmount = 7,
    BelowMinimum = 8,
    SelfTip = 9,
    DuplicateClientRef = 10,
    BatchEmpty = 11,
    BatchTooLarge = 12,
    Overflow = 13,
    AlreadyMigrated = 14,
    TooManyTokens = 15,
    InvalidMinimum = 16,
    SameAuthor = 17,
    AdminRenounceDisabled = 18,
    NoPendingAuthor = 19,
    InvalidExpiry = 20,
    TokenEnabled = 21,
}
