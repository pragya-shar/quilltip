//! Role administration shared by Core, Tab and the article NFT
//! (`01-architecture.md`, section 1.5).
//!
//! The `upgrader` role is self-administered: only an account that holds
//! `upgrader` can grant or revoke it, and its role admin cannot be changed.
//! The admin alone cannot change it. On mainnet the upgrader is a timelock,
//! so this keeps every code change behind the timelock delay.
//!
//! Because the admin cannot restore the role, the last `upgrader` can neither
//! be revoked nor renounce. Grant a successor first, then remove the old one.
//!
//! All other roles keep the OpenZeppelin rules: the admin, or a holder of the
//! role's admin role, grants and revokes them.

use soroban_sdk::{panic_with_error, Address, Env, Symbol};
use stellar_access::access_control::{self as access_control, AccessControlError};

/// The role that may upgrade and migrate.
pub const UPGRADER_ROLE: &str = "upgrader";

fn is_upgrader_role(e: &Env, role: &Symbol) -> bool {
    *role == Symbol::new(e, UPGRADER_ROLE)
}

/// Requires `caller` to authorise and to hold `upgrader`.
fn require_upgrader(e: &Env, caller: &Address) {
    caller.require_auth();
    if access_control::has_role(e, caller, &Symbol::new(e, UPGRADER_ROLE)).is_none() {
        panic_with_error!(e, AccessControlError::Unauthorized);
    }
}

/// OpenZeppelin `grant_role`, except that only an upgrader grants `upgrader`.
pub fn grant_role(e: &Env, account: &Address, role: &Symbol, caller: &Address) {
    if is_upgrader_role(e, role) {
        require_upgrader(e, caller);
        access_control::grant_role_no_auth(e, account, role, caller);
    } else {
        access_control::grant_role(e, account, role, caller);
    }
}

/// Fails when `account` holds `upgrader` and is its only holder.
fn require_not_last_upgrader(e: &Env, account: &Address, role: &Symbol) {
    if access_control::has_role(e, account, role).is_some()
        && access_control::get_role_member_count(e, role) <= 1
    {
        panic_with_error!(e, AccessControlError::Unauthorized);
    }
}

/// OpenZeppelin `revoke_role`, except that only an upgrader revokes `upgrader`,
/// and never its last holder.
pub fn revoke_role(e: &Env, account: &Address, role: &Symbol, caller: &Address) {
    if is_upgrader_role(e, role) {
        require_upgrader(e, caller);
        require_not_last_upgrader(e, account, role);
        access_control::revoke_role_no_auth(e, account, role, caller);
    } else {
        access_control::revoke_role(e, account, role, caller);
    }
}

/// OpenZeppelin `renounce_role`, except that the last `upgrader` cannot renounce.
pub fn renounce_role(e: &Env, role: &Symbol, caller: &Address) {
    if is_upgrader_role(e, role) {
        require_not_last_upgrader(e, caller, role);
    }
    access_control::renounce_role(e, role, caller);
}

/// OpenZeppelin `set_role_admin`, except that the role admin of `upgrader`
/// cannot be set.
pub fn set_role_admin(e: &Env, role: &Symbol, admin_role: &Symbol) {
    if is_upgrader_role(e, role) {
        panic_with_error!(e, AccessControlError::Unauthorized);
    }
    access_control::set_role_admin(e, role, admin_role);
}
