//! TTL helpers (`01-architecture.md`, section 1.5).
//!
//! - Every state-changing entry point calls [`extend_instance`].
//! - Every persistent write calls [`extend_persistent`] for that key.
//! - Temporary entries get an explicit TTL through [`extend_temporary`].

use soroban_sdk::{Env, IntoVal, Val};

use crate::constants::{TTL_EXTEND_TO, TTL_THRESHOLD};

/// Extends the contract instance and code TTL with the shared policy.
pub fn extend_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Extends a persistent entry with the shared policy.
pub fn extend_persistent<K>(e: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    e.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Extends a temporary entry so that it lives at least `ledgers` more ledgers.
///
/// A `ledgers` value of 0 is raised to 1. TTLs are never shortened.
pub fn extend_temporary<K>(e: &Env, key: &K, ledgers: u32)
where
    K: IntoVal<Env, Val>,
{
    let ledgers = ledgers.max(1);
    e.storage().temporary().extend_ttl(key, ledgers, ledgers);
}

/// Ledgers from `now` until the end of `until` (inclusive), at least 1.
///
/// Used for temporary entries that must stay live until a known ledger, for
/// example `valid_until + SETTLE_GRACE`. Saturates instead of overflowing.
pub fn ledgers_until(now: u32, until: u32) -> u32 {
    until.saturating_sub(now).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::storage::{Instance, Persistent, Temporary};
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::{contract, symbol_short};

    #[contract]
    struct Probe;

    #[test]
    fn policy_values() {
        assert_eq!(TTL_THRESHOLD, 518_400);
        assert_eq!(TTL_EXTEND_TO, 2_073_600);
        assert_eq!(ledgers_until(100, 50), 1);
        assert_eq!(ledgers_until(100, 100), 1);
        assert_eq!(ledgers_until(100, 160), 60);
    }

    #[test]
    fn extensions_apply_the_policy() {
        let e = Env::default();
        e.ledger().set_sequence_number(1_000);
        let id = e.register(Probe, ());
        let key = symbol_short!("k");
        e.as_contract(&id, || {
            e.storage().persistent().set(&key, &1u32);
            e.storage().temporary().set(&key, &1u32);
            extend_instance(&e);
            extend_persistent(&e, &key);
            extend_temporary(&e, &key, 500);
            assert_eq!(e.storage().instance().get_ttl(), TTL_EXTEND_TO);
            assert_eq!(e.storage().persistent().get_ttl(&key), TTL_EXTEND_TO);
            assert!(e.storage().temporary().get_ttl(&key) >= 500);
        });
    }
}
