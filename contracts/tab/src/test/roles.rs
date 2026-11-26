//! Only an upgrader can change the `upgrader` role (`01-architecture.md`,
//! section 1.5). The admin alone cannot grant itself the role and upgrade.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Error, IntoVal, Symbol};

use super::Fixture;
use crate::contract::{ROLE_SETTLER, ROLE_UPGRADER};

fn unauthorized() -> Option<Result<Error, soroban_sdk::InvokeError>> {
    Some(Ok(Error::from_contract_error(2000)))
}

#[test]
fn admin_cannot_grant_upgrader() {
    let f = Fixture::new();
    f.auth(
        &f.admin,
        "grant_role",
        (f.admin.clone(), ROLE_UPGRADER, f.admin.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.client()
            .try_grant_role(&f.admin, &ROLE_UPGRADER, &f.admin)
            .err(),
        unauthorized()
    );
    assert!(f.client().has_role(&f.admin, &ROLE_UPGRADER).is_none());

    // Without the role, the admin cannot upgrade.
    let hash = BytesN::from_array(&f.e, &[7; 32]);
    f.auth(
        &f.admin,
        "upgrade",
        (hash.clone(), f.admin.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.client().try_upgrade(&hash, &f.admin).err(),
        unauthorized()
    );
}

#[test]
fn admin_cannot_revoke_upgrader() {
    let f = Fixture::new();
    f.auth(
        &f.admin,
        "revoke_role",
        (f.upgrader.clone(), ROLE_UPGRADER, f.admin.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.client()
            .try_revoke_role(&f.upgrader, &ROLE_UPGRADER, &f.admin)
            .err(),
        unauthorized()
    );
    assert!(f.client().has_role(&f.upgrader, &ROLE_UPGRADER).is_some());
}

#[test]
fn upgrader_grants_and_revokes_upgrader() {
    let f = Fixture::new();
    let next = Address::generate(&f.e);
    f.auth(
        &f.upgrader,
        "grant_role",
        (next.clone(), ROLE_UPGRADER, f.upgrader.clone()).into_val(&f.e),
    );
    f.client().grant_role(&next, &ROLE_UPGRADER, &f.upgrader);
    assert!(f.client().has_role(&next, &ROLE_UPGRADER).is_some());

    f.auth(
        &next,
        "revoke_role",
        (f.upgrader.clone(), ROLE_UPGRADER, next.clone()).into_val(&f.e),
    );
    f.client().revoke_role(&f.upgrader, &ROLE_UPGRADER, &next);
    assert!(f.client().has_role(&f.upgrader, &ROLE_UPGRADER).is_none());
}

#[test]
fn upgrader_role_admin_cannot_be_set() {
    let f = Fixture::new();
    let pauser = Symbol::new(&f.e, "pauser");
    f.auth(
        &f.admin,
        "set_role_admin",
        (ROLE_UPGRADER, pauser.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.client().try_set_role_admin(&ROLE_UPGRADER, &pauser).err(),
        unauthorized()
    );
    assert_eq!(f.client().get_role_admin(&ROLE_UPGRADER), None);

    // Other roles keep the OpenZeppelin rules: the admin still grants `settler`.
    let relayer = Address::generate(&f.e);
    f.auth(
        &f.admin,
        "grant_role",
        (relayer.clone(), ROLE_SETTLER, f.admin.clone()).into_val(&f.e),
    );
    f.client().grant_role(&relayer, &ROLE_SETTLER, &f.admin);
    assert!(f.client().has_role(&relayer, &ROLE_SETTLER).is_some());
}
