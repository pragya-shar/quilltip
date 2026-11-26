//! Only an upgrader can change the `upgrader` role (`01-architecture.md`,
//! section 1.5). The admin alone cannot grant itself the role and upgrade.

use soroban_sdk::{testutils::Address as _, Address, BytesN, IntoVal, Symbol};
use stellar_access::access_control::AccessControlError;

use super::{assert_fails, setup};
use crate::{PAUSER_ROLE, UPGRADER_ROLE};

#[test]
fn admin_cannot_grant_upgrader() {
    let s = setup();
    let role = Symbol::new(&s.e, UPGRADER_ROLE);
    s.allow(
        &s.admin,
        "grant_role",
        (s.admin.clone(), role.clone(), s.admin.clone()).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_grant_role(&s.admin, &role, &s.admin),
        AccessControlError::Unauthorized,
    );
    assert!(s.nft.has_role(&s.admin, &role).is_none());

    // Without the role, the admin cannot upgrade.
    let hash = BytesN::from_array(&s.e, &[7; 32]);
    s.allow(
        &s.admin,
        "upgrade",
        (hash.clone(), s.admin.clone()).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_upgrade(&hash, &s.admin),
        AccessControlError::Unauthorized,
    );
}

#[test]
fn admin_cannot_revoke_upgrader() {
    let s = setup();
    let role = Symbol::new(&s.e, UPGRADER_ROLE);
    s.allow(
        &s.admin,
        "revoke_role",
        (s.upgrader.clone(), role.clone(), s.admin.clone()).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_revoke_role(&s.upgrader, &role, &s.admin),
        AccessControlError::Unauthorized,
    );
    assert!(s.nft.has_role(&s.upgrader, &role).is_some());
}

#[test]
fn upgrader_grants_and_revokes_upgrader() {
    let s = setup();
    let role = Symbol::new(&s.e, UPGRADER_ROLE);
    let next = Address::generate(&s.e);
    s.allow(
        &s.upgrader,
        "grant_role",
        (next.clone(), role.clone(), s.upgrader.clone()).into_val(&s.e),
    );
    s.nft.grant_role(&next, &role, &s.upgrader);
    assert!(s.nft.has_role(&next, &role).is_some());

    s.allow(
        &next,
        "revoke_role",
        (s.upgrader.clone(), role.clone(), next.clone()).into_val(&s.e),
    );
    s.nft.revoke_role(&s.upgrader, &role, &next);
    assert!(s.nft.has_role(&s.upgrader, &role).is_none());
}

#[test]
fn upgrader_role_admin_cannot_be_set() {
    let s = setup();
    let role = Symbol::new(&s.e, UPGRADER_ROLE);
    let pauser = Symbol::new(&s.e, PAUSER_ROLE);
    s.allow(
        &s.admin,
        "set_role_admin",
        (role.clone(), pauser.clone()).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_set_role_admin(&role, &pauser),
        AccessControlError::Unauthorized,
    );
    assert_eq!(s.nft.get_role_admin(&role), None);
}
