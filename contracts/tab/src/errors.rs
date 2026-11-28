//! `TabError` (codes 30 to 69). Specification: `03-tab-contract.md`, section 3.10.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TabError {
    /// `open_session` with a negative amount.
    InvalidAmount = 30,
    /// `deposit` below `min_deposit`.
    BelowMinimumDeposit = 31,
    /// A deposit would take the balance above `max_balance`.
    BalanceCapExceeded = 32,
    /// `valid_until` is not in `(now, now + MAX_KEY_LIFETIME]`.
    InvalidKeyExpiry = 33,
    /// A zero public key, or `spend_limit <= 0`.
    InvalidKey = 34,
    /// No session key with this `key_id`.
    KeyNotFound = 35,
    /// `settle` or `settle_own` with no vouchers.
    BatchEmpty = 36,
    /// More than `MAX_SETTLE_BATCH` vouchers.
    BatchTooLarge = 37,
    /// `settle_own` with a voucher for another writer.
    WrongWriter = 38,
    /// `withdraw_start` with a zero balance.
    NothingToWithdraw = 39,
    /// `withdraw_start` while a withdrawal is pending.
    WithdrawPending = 40,
    /// `withdraw` before the unlock ledger.
    WithdrawLocked = 41,
    /// `withdraw` with no withdrawal pending.
    NoWithdrawPending = 42,
    /// Checked arithmetic overflowed.
    Overflow = 43,
    /// `migrate` when the stored schema version is already current.
    AlreadyMigrated = 44,
    /// `min_deposit <= 0` or `min_deposit > max_balance`.
    InvalidLimits = 45,
    /// `renounce_admin` is disabled.
    AdminRenounceDisabled = 46,
    /// A session key exists without its reader account (breaks I-28).
    AccountMissing = 47,
    /// `grant_session` with `spend_limit > amount`.
    GrantCapAboveAmount = 48,
    /// `grant_session` for a reader that already has a balance or a key.
    GrantAccountInUse = 49,
    /// `grant_gift` with a `key_id` that is not a live, unrevoked granted key.
    GrantKeyNotLive = 50,
}
