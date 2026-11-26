//! Upgrade test fixture. Built only with `--features upgrade-probe`.
//!
//! After `upgrade` replaces the Tab code with this contract, the test reads
//! the stored state through it to show that an upgrade preserves storage (I-30).

use soroban_sdk::{contract, contractimpl, Address, Env};
use stellar_contract_utils::upgradeable;

use crate::storage::{self, TabConfig};

#[contract]
pub struct UpgradeProbe;

#[contractimpl]
impl UpgradeProbe {
    pub fn probe_schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    pub fn probe_balance(e: &Env, reader: Address) -> i128 {
        storage::account(e, &reader)
            .map(|a| a.balance)
            .unwrap_or(-1)
    }

    pub fn probe_next_key_id(e: &Env, reader: Address) -> u32 {
        storage::account(e, &reader)
            .map(|a| a.next_key_id)
            .unwrap_or(u32::MAX)
    }

    pub fn probe_claimable(e: &Env, owner: Address) -> i128 {
        storage::claimable(e, &owner)
    }

    pub fn probe_config(e: &Env) -> TabConfig {
        storage::config(e)
    }
}
