//! Constructor, views, token allowlist, treasury, roles, pause (I-4, I-26).

use soroban_sdk::{testutils::Address as _, Address, Symbol};
use stellar_access::access_control::AccessControlError;

use super::*;
use crate::{CoreError, TokenConfig, MAX_TOKENS};

#[test]
fn constructor_sets_configuration() {
    let f = Fixture::new();
    assert_eq!(f.core.treasury(), f.treasury);
    assert_eq!(f.core.fee_bps(), 250);
    assert_eq!(f.core.min_tip(&f.token), MIN_TIP);
    assert_eq!(
        f.core.token_config(&f.token),
        Some(TokenConfig {
            min_tip: MIN_TIP,
            enabled: true
        })
    );
    assert_eq!(f.core.schema_version(), 1);
    assert_eq!(f.core.get_admin(), Some(f.admin.clone()));
    assert!(f
        .core
        .has_role(&f.pauser, &Symbol::new(&f.e, "pauser"))
        .is_some());
    assert!(f
        .core
        .has_role(&f.upgrader, &Symbol::new(&f.e, "upgrader"))
        .is_some());
    assert!(!f.core.paused());
}

#[test]
fn constructor_rejects_low_minimum() {
    let e = Env::default();
    let a = Address::generate(&e);
    let token = e.register_stellar_asset_contract_v2(a.clone()).address();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        e.register(QuillTipCore, (&a, &a, &a, &a, &token, 39i128));
    }));
    let payload = result.expect_err("min_tip below 40 must fail");
    let message = payload
        .downcast_ref::<std::string::String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|s| std::string::String::from(*s))
        })
        .unwrap_or_default();
    // CoreError::InvalidMinimum = 16.
    assert!(message.contains("Error(Contract, #16)"), "{message}");
}

/// I-26: no public `initialize`.
#[test]
fn no_initialize_entry_point() {
    let f = Fixture::new();
    let args: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![&f.e];
    let result =
        f.e.try_invoke_contract::<soroban_sdk::Val, soroban_sdk::Error>(
            &f.id(),
            &Symbol::new(&f.e, "initialize"),
            args,
        );
    assert!(result.is_err());
}

#[test]
fn views_for_missing_entries() {
    let f = Fixture::new();
    let id = random_id(&f.e);
    assert_eq!(f.core.get_article(&id), None);
    assert_core_err!(f.core.try_article_author(&id), CoreError::NotRegistered);
    assert_eq!(f.core.article_total(&id, &f.token), 0);
    let unknown = f.new_token();
    assert_eq!(f.core.token_config(&unknown), None);
    assert_core_err!(f.core.try_min_tip(&unknown), CoreError::TokenNotAllowed);
    f.core.set_token(&unknown, &MIN_TIP, &false);
    assert_core_err!(f.core.try_min_tip(&unknown), CoreError::TokenNotAllowed);
}

#[test]
fn set_token_limits() {
    let f = Fixture::new();
    assert_core_err!(
        f.core.try_set_token(&f.token, &39, &true),
        CoreError::InvalidMinimum
    );
    // Update in place does not use a slot.
    f.core.set_token(&f.token, &40, &true);
    assert_eq!(f.core.min_tip(&f.token), 40);
    let mut added = std::vec::Vec::new();
    for _ in 1..MAX_TOKENS {
        let t = f.new_token();
        f.core.set_token(&t, &MIN_TIP, &true);
        added.push(t);
    }
    let extra = f.new_token();
    assert_core_err!(
        f.core.try_set_token(&extra, &MIN_TIP, &true),
        CoreError::TooManyTokens
    );
    // Removing a disabled token frees a slot.
    f.core.set_token(&added[0], &MIN_TIP, &false);
    f.core.remove_token(&added[0]);
    f.core.set_token(&extra, &MIN_TIP, &true);
}

#[test]
fn remove_token_rules() {
    let f = Fixture::new();
    assert_core_err!(f.core.try_remove_token(&f.token), CoreError::TokenEnabled);
    assert_core_err!(
        f.core.try_remove_token(&f.new_token()),
        CoreError::TokenNotAllowed
    );
    // Totals recorded for a removed token stay.
    let (id, _) = f.article();
    let tipper = f.funded();
    f.core.tip(
        &tipper,
        &id,
        &f.token,
        &MIN_TIP,
        &None,
        &client_ref(&f.e, 1),
    );
    f.core.set_token(&f.token, &MIN_TIP, &false);
    f.core.remove_token(&f.token);
    assert_eq!(f.core.token_config(&f.token), None);
    assert_eq!(f.core.article_total(&id, &f.token), MIN_TIP);
}

#[test]
fn set_treasury_replaces() {
    let f = Fixture::new();
    let t = Address::generate(&f.e);
    f.core.set_treasury(&t);
    assert_eq!(f.core.treasury(), t);
}

/// I-26: pause needs the `pauser` role and unpause needs the admin.
#[test]
fn pause_roles() {
    let f = Fixture::new();
    let other = Address::generate(&f.e);
    assert_eq!(
        f.core.try_pause(&other).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    assert_eq!(
        f.core.try_pause(&f.admin).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    f.core.pause(&f.pauser);
    assert!(f.core.paused());
    assert_eq!(
        f.core.try_unpause(&f.pauser).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    f.core.unpause(&f.admin);
    assert!(!f.core.paused());
}

/// Views keep working while paused.
#[test]
fn views_while_paused() {
    let f = Fixture::new();
    let (id, author) = f.article();
    f.core.pause(&f.pauser);
    assert_eq!(f.core.article_author(&id), author);
    assert_eq!(f.core.article_total(&id, &f.token), 0);
    assert_eq!(f.core.fee_bps(), 250);
    assert_eq!(f.core.min_tip(&f.token), MIN_TIP);
}

/// I-26: `renounce_admin` always fails.
#[test]
fn renounce_admin_disabled() {
    let f = Fixture::new();
    assert_core_err!(
        f.core.try_renounce_admin(),
        CoreError::AdminRenounceDisabled
    );
    assert_eq!(f.core.get_admin(), Some(f.admin.clone()));
}

/// Two-step admin transfer through OpenZeppelin `AccessControl`.
#[test]
fn admin_transfer_two_step() {
    let f = Fixture::new();
    let next = Address::generate(&f.e);
    f.core.transfer_admin_role(&next, &(START_LEDGER + 100));
    assert_eq!(f.core.get_admin(), Some(f.admin.clone()));
    f.core.accept_admin_transfer();
    assert_eq!(f.core.get_admin(), Some(next.clone()));
    // The new admin can unpause; the old one cannot.
    f.core.pause(&f.pauser);
    assert_eq!(
        f.core.try_unpause(&f.admin).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    f.core.unpause(&next);
}

/// I-26: the admin grants and revokes roles; others cannot.
#[test]
fn role_management() {
    let f = Fixture::new();
    let p2 = Address::generate(&f.e);
    let role = Symbol::new(&f.e, "pauser");
    f.core.grant_role(&p2, &role, &f.admin);
    f.core.pause(&p2);
    f.core.unpause(&f.admin);
    f.core.revoke_role(&p2, &role, &f.admin);
    assert_eq!(
        f.core.try_pause(&p2).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    let stranger = Address::generate(&f.e);
    assert_eq!(
        f.core.try_grant_role(&stranger, &role, &stranger).err(),
        Some(contract_err(AccessControlError::Unauthorized as u32))
    );
}
