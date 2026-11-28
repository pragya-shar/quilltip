//! QuillTip Tab contract: prepaid reader tabs, session-key vouchers and batched settlement.
//!
//! Specification: `docs/architecture/v2/03-tab-contract.md`. Invariants (`I-n`)
//! are defined in `07-security-and-recovery.md`, section 7.1.
#![no_std]
#![cfg_attr(feature = "upgrade-probe", allow(dead_code))]

#[cfg(not(feature = "upgrade-probe"))]
mod contract;
mod errors;
#[cfg(not(feature = "upgrade-probe"))]
mod events;
#[cfg(feature = "upgrade-probe")]
mod probe;
mod storage;

#[cfg(all(test, not(feature = "upgrade-probe")))]
mod test;

#[cfg(not(feature = "upgrade-probe"))]
pub use contract::{
    QuillTipTab, QuillTipTabClient, ROLE_GRANTOR, ROLE_PAUSER, ROLE_SETTLER, ROLE_UPGRADER,
};
pub use errors::TabError;
pub use storage::{
    ReaderAccount, SessionKey, SettleSummary, TabConfig, Voucher, MAX_ACCEPTOR_KEYS,
    MAX_KEY_LIFETIME, MAX_SETTLE_BATCH, SCHEMA_VERSION, SETTLE_GRACE, SKIP_KEY_EXPIRED,
    SKIP_KEY_UNKNOWN, SKIP_NOT_ACCEPTED, SKIP_SHORTFALL, SKIP_STALE, WITHDRAW_DELAY,
};

soroban_sdk::contractmeta!(key = "name", val = "quilltip-tab");
soroban_sdk::contractmeta!(key = "version", val = env!("CARGO_PKG_VERSION"));
soroban_sdk::contractmeta!(key = "schema_version", val = "1");
