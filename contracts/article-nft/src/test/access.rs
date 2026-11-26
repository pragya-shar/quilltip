//! Constructor, roles, pause and administration (I-26).

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, IntoVal, String, Symbol,
};
use stellar_access::access_control::AccessControlError;
use stellar_contract_utils::pausable::PausableError;

use super::{assert_fails, auth_error, setup, MockCore, BASE_URI, THRESHOLD};
use crate::{NftError, QuillTipArticleNft, PAUSER_ROLE, SCHEMA_VERSION, UPGRADER_ROLE};

#[test]
fn constructor_sets_admin_roles_threshold_and_schema() {
    let s = setup();
    assert_eq!(s.nft.get_admin(), Some(s.admin.clone()));
    let pauser = Symbol::new(&s.e, PAUSER_ROLE);
    let upgrader = Symbol::new(&s.e, UPGRADER_ROLE);
    assert!(s.nft.has_role(&s.pauser, &pauser).is_some());
    assert!(s.nft.has_role(&s.upgrader, &upgrader).is_some());
    assert!(s.nft.has_role(&s.admin, &pauser).is_none());
    // Only the two roles exist; no `manager` role.
    assert_eq!(s.nft.get_existing_roles().len(), 2);
    assert_eq!(s.nft.threshold(), (s.xlm.clone(), THRESHOLD));
    assert_eq!(s.nft.schema_version(), SCHEMA_VERSION);
    assert!(!s.nft.paused());
}

fn register_with_threshold(threshold: i128) {
    let e = soroban_sdk::Env::default();
    let a = Address::generate(&e);
    let core = e.register(MockCore, ());
    e.register(
        QuillTipArticleNft,
        (
            &a,
            &a,
            &a,
            &core,
            &a,
            threshold,
            String::from_str(&e, BASE_URI),
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #72)")]
fn constructor_rejects_a_zero_threshold() {
    register_with_threshold(0);
}

#[test]
#[should_panic(expected = "Error(Contract, #72)")]
fn constructor_rejects_a_negative_threshold() {
    register_with_threshold(-1);
}

#[test]
fn set_threshold_by_admin() {
    let s = setup();
    let usdc = Address::generate(&s.e);
    s.allow(
        &s.admin,
        "set_threshold",
        (usdc.clone(), 42_i128).into_val(&s.e),
    );
    s.nft.set_threshold(&usdc, &42);
    assert_eq!(s.nft.threshold(), (usdc, 42));
}

#[test]
fn set_threshold_rejects_non_admins_and_bad_values() {
    let s = setup();
    for who in [s.pauser.clone(), s.upgrader.clone(), s.author.clone()] {
        s.allow(
            &who,
            "set_threshold",
            (s.xlm.clone(), 1_i128).into_val(&s.e),
        );
        assert_fails(s.nft.try_set_threshold(&s.xlm, &1), auth_error());
    }
    for bad in [0_i128, -5] {
        s.allow(
            &s.admin,
            "set_threshold",
            (s.xlm.clone(), bad).into_val(&s.e),
        );
        assert_fails(
            s.nft.try_set_threshold(&s.xlm, &bad),
            NftError::InvalidThreshold,
        );
    }
    assert_eq!(s.nft.threshold(), (s.xlm.clone(), THRESHOLD));
}

#[test]
fn pause_needs_the_pauser_role_and_unpause_the_admin() {
    let s = setup();
    // The admin does not hold `pauser`.
    s.allow(&s.admin, "pause", (s.admin.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_pause(&s.admin), AccessControlError::Unauthorized);
    // The pauser named as caller must sign.
    s.allow(&s.admin, "pause", (s.pauser.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_pause(&s.pauser), auth_error());

    s.allow(&s.pauser, "pause", (s.pauser.clone(),).into_val(&s.e));
    s.nft.pause(&s.pauser);
    assert!(s.nft.paused());
    s.allow(&s.pauser, "pause", (s.pauser.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_pause(&s.pauser), PausableError::EnforcedPause);

    // The pauser cannot unpause; the admin must sign as the caller.
    s.allow(&s.pauser, "unpause", (s.pauser.clone(),).into_val(&s.e));
    assert_fails(
        s.nft.try_unpause(&s.pauser),
        AccessControlError::Unauthorized,
    );
    s.allow(&s.pauser, "unpause", (s.admin.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_unpause(&s.admin), auth_error());

    s.allow(&s.admin, "unpause", (s.admin.clone(),).into_val(&s.e));
    s.nft.unpause(&s.admin);
    assert!(!s.nft.paused());
    s.allow(&s.admin, "unpause", (s.admin.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_unpause(&s.admin), PausableError::ExpectedPause);
}

#[test]
fn renounce_admin_always_fails() {
    let s = setup();
    s.allow(&s.admin, "renounce_admin", ().into_val(&s.e));
    assert_fails(s.nft.try_renounce_admin(), NftError::AdminRenounceDisabled);
    s.no_auth();
    assert_fails(s.nft.try_renounce_admin(), NftError::AdminRenounceDisabled);
    assert_eq!(s.nft.get_admin(), Some(s.admin.clone()));
}

#[test]
fn admin_grants_and_revokes_roles() {
    let s = setup();
    let role = Symbol::new(&s.e, PAUSER_ROLE);
    let second_pauser = Address::generate(&s.e);

    s.allow(
        &s.pauser,
        "grant_role",
        (second_pauser.clone(), role.clone(), s.pauser.clone()).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_grant_role(&second_pauser, &role, &s.pauser),
        AccessControlError::Unauthorized,
    );

    s.allow(
        &s.admin,
        "grant_role",
        (second_pauser.clone(), role.clone(), s.admin.clone()).into_val(&s.e),
    );
    s.nft.grant_role(&second_pauser, &role, &s.admin);
    s.allow(
        &second_pauser,
        "pause",
        (second_pauser.clone(),).into_val(&s.e),
    );
    s.nft.pause(&second_pauser);

    s.allow(
        &s.admin,
        "revoke_role",
        (second_pauser.clone(), role.clone(), s.admin.clone()).into_val(&s.e),
    );
    s.nft.revoke_role(&second_pauser, &role, &s.admin);
    assert!(s.nft.has_role(&second_pauser, &role).is_none());
}

#[test]
fn admin_transfer_is_two_step() {
    let s = setup();
    let new_admin = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 100;
    s.allow(
        &s.admin,
        "transfer_admin_role",
        (new_admin.clone(), live_until).into_val(&s.e),
    );
    s.nft.transfer_admin_role(&new_admin, &live_until);
    // Nothing changes until the new admin accepts.
    assert_eq!(s.nft.get_admin(), Some(s.admin.clone()));

    s.allow(&s.admin, "accept_admin_transfer", ().into_val(&s.e));
    assert_fails(s.nft.try_accept_admin_transfer(), auth_error());

    s.allow(&new_admin, "accept_admin_transfer", ().into_val(&s.e));
    s.nft.accept_admin_transfer();
    assert_eq!(s.nft.get_admin(), Some(new_admin.clone()));

    // The previous admin lost admin rights.
    s.allow(
        &s.admin,
        "set_threshold",
        (s.xlm.clone(), 7_i128).into_val(&s.e),
    );
    assert_fails(s.nft.try_set_threshold(&s.xlm, &7), auth_error());
    s.allow(
        &new_admin,
        "set_threshold",
        (s.xlm.clone(), 7_i128).into_val(&s.e),
    );
    s.nft.set_threshold(&s.xlm, &7);
}

#[test]
fn an_expired_admin_offer_cannot_be_accepted() {
    let s = setup();
    let new_admin = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 10;
    s.allow(
        &s.admin,
        "transfer_admin_role",
        (new_admin.clone(), live_until).into_val(&s.e),
    );
    s.nft.transfer_admin_role(&new_admin, &live_until);
    s.e.ledger().set_sequence_number(live_until + 1);
    s.allow(&new_admin, "accept_admin_transfer", ().into_val(&s.e));
    assert!(s.nft.try_accept_admin_transfer().is_err());
    assert_eq!(s.nft.get_admin(), Some(s.admin.clone()));
}
