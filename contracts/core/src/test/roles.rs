//! Only an upgrader can change the `upgrader` role (`01-architecture.md`,
//! section 1.5). The admin alone cannot grant itself the role and upgrade.

use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, IntoVal, Symbol, Val, Vec};

use super::*;

/// Authorises exactly one root invocation of Core by `who`.
fn auth(f: &Fixture, who: &Address, fn_name: &str, args: Vec<Val>) {
    let core = f.id();
    f.e.mock_auths(&[MockAuth {
        address: who,
        invoke: &MockAuthInvoke {
            contract: &core,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

fn upgrader_role(f: &Fixture) -> Symbol {
    Symbol::new(&f.e, "upgrader")
}

#[test]
fn admin_cannot_grant_upgrader() {
    let f = Fixture::new();
    let role = upgrader_role(&f);
    auth(
        &f,
        &f.admin,
        "grant_role",
        (f.admin.clone(), role.clone(), f.admin.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.core.try_grant_role(&f.admin, &role, &f.admin).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    assert!(f.core.has_role(&f.admin, &role).is_none());

    // Without the role, the admin cannot upgrade.
    auth(
        &f,
        &f.admin,
        "upgrade",
        (BytesN::<32>::from_array(&f.e, &[7; 32]), f.admin.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.core
            .try_upgrade(&BytesN::from_array(&f.e, &[7; 32]), &f.admin)
            .err(),
        Some(contract_err(UNAUTHORIZED))
    );
}

#[test]
fn admin_cannot_revoke_upgrader() {
    let f = Fixture::new();
    let role = upgrader_role(&f);
    auth(
        &f,
        &f.admin,
        "revoke_role",
        (f.upgrader.clone(), role.clone(), f.admin.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.core.try_revoke_role(&f.upgrader, &role, &f.admin).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    assert!(f.core.has_role(&f.upgrader, &role).is_some());
}

#[test]
fn upgrader_grants_and_revokes_upgrader() {
    let f = Fixture::new();
    let role = upgrader_role(&f);
    let next = Address::generate(&f.e);

    auth(
        &f,
        &f.upgrader,
        "grant_role",
        (next.clone(), role.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    f.core.grant_role(&next, &role, &f.upgrader);
    assert!(f.core.has_role(&next, &role).is_some());

    auth(
        &f,
        &next,
        "revoke_role",
        (f.upgrader.clone(), role.clone(), next.clone()).into_val(&f.e),
    );
    f.core.revoke_role(&f.upgrader, &role, &next);
    assert!(f.core.has_role(&f.upgrader, &role).is_none());
}

#[test]
fn upgrader_role_admin_cannot_be_set() {
    let f = Fixture::new();
    let role = upgrader_role(&f);
    let pauser_role = Symbol::new(&f.e, "pauser");
    auth(
        &f,
        &f.admin,
        "set_role_admin",
        (role.clone(), pauser_role.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.core.try_set_role_admin(&role, &pauser_role).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    assert_eq!(f.core.get_role_admin(&role), None);

    // Other roles keep the OpenZeppelin rules.
    let settler_role = Symbol::new(&f.e, "settler");
    auth(
        &f,
        &f.admin,
        "set_role_admin",
        (settler_role.clone(), role.clone()).into_val(&f.e),
    );
    f.core.set_role_admin(&settler_role, &role);
    assert_eq!(f.core.get_role_admin(&settler_role), Some(role));
}

/// The admin cannot restore `upgrader`, so its last holder can neither be
/// revoked nor renounce. A successor must be granted first.
#[test]
fn last_upgrader_cannot_leave() {
    let f = Fixture::new();
    let role = upgrader_role(&f);
    auth(
        &f,
        &f.upgrader,
        "revoke_role",
        (f.upgrader.clone(), role.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.core
            .try_revoke_role(&f.upgrader, &role, &f.upgrader)
            .err(),
        Some(contract_err(UNAUTHORIZED))
    );
    auth(
        &f,
        &f.upgrader,
        "renounce_role",
        (role.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    assert_eq!(
        f.core.try_renounce_role(&role, &f.upgrader).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    assert!(f.core.has_role(&f.upgrader, &role).is_some());

    // With a successor in place, the old upgrader can renounce.
    let next = Address::generate(&f.e);
    auth(
        &f,
        &f.upgrader,
        "grant_role",
        (next.clone(), role.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    f.core.grant_role(&next, &role, &f.upgrader);
    auth(
        &f,
        &f.upgrader,
        "renounce_role",
        (role.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    f.core.renounce_role(&role, &f.upgrader);
    assert!(f.core.has_role(&f.upgrader, &role).is_none());
    assert!(f.core.has_role(&next, &role).is_some());
}
