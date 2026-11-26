//! Constructor, roles, configuration, pause scope, renounce and migrate.
use super::*;
use crate::events::{AcceptorSet, LimitsSet, Migrated, TreasurySet};
use crate::{TabError, ROLE_PAUSER, ROLE_SETTLER, ROLE_UPGRADER};
use soroban_sdk::Event as _;
use stellar_contract_utils::upgradeable;

fn register(e: &Env, max_balance: i128, min_deposit: i128, acceptor: BytesN<32>) -> Address {
    let a = Address::generate(e);
    let token = e.register_stellar_asset_contract_v2(a.clone()).address();
    e.register(
        QuillTipTab,
        (
            &a,
            &a,
            &a,
            &a,
            &token,
            &a,
            max_balance,
            min_deposit,
            acceptor,
        ),
    )
}

#[test]
fn constructor_sets_config_roles_and_schema() {
    // I-26: configuration comes only from the constructor; roles are granted there.
    let f = Fixture::new();
    let c = f.client();
    let cfg = c.config();
    assert_eq!(cfg.token, f.token);
    assert_eq!(cfg.treasury, f.treasury);
    assert_eq!(
        (cfg.max_balance, cfg.min_deposit),
        (MAX_BALANCE, MIN_DEPOSIT)
    );
    assert_eq!(
        cfg.acceptor_keys,
        soroban_sdk::vec![&f.e, public_key(&f.e, &f.acceptor)]
    );
    assert_eq!(c.schema_version(), crate::SCHEMA_VERSION);
    assert_eq!(c.get_admin(), Some(f.admin.clone()));
    assert!(c.has_role(&f.pauser, &ROLE_PAUSER).is_some());
    assert!(c.has_role(&f.upgrader, &ROLE_UPGRADER).is_some());
    assert!(c.has_role(&f.settler, &ROLE_SETTLER).is_some());
    assert!(c.has_role(&f.admin, &ROLE_SETTLER).is_none());
    assert!(!c.paused());
}

#[test]
#[should_panic(expected = "Error(Contract, #45)")]
fn constructor_rejects_zero_min_deposit() {
    let e = Env::default();
    register(&e, MAX_BALANCE, 0, BytesN::from_array(&e, &[1; 32]));
}

#[test]
#[should_panic(expected = "Error(Contract, #45)")]
fn constructor_rejects_min_above_max() {
    let e = Env::default();
    register(&e, 10, 11, BytesN::from_array(&e, &[1; 32]));
}

#[test]
#[should_panic(expected = "Error(Contract, #34)")]
fn constructor_rejects_zero_acceptor() {
    let e = Env::default();
    register(
        &e,
        MAX_BALANCE,
        MIN_DEPOSIT,
        BytesN::from_array(&e, &[0; 32]),
    );
}

#[test]
fn set_limits_is_admin_only_and_validated() {
    let f = Fixture::new();
    f.auth(&f.admin, "set_limits", (5 * XLM, XLM).into_val(&f.e));
    f.client().set_limits(&(5 * XLM), &XLM);
    assert_eq!(
        f.tab_events(),
        std::vec![LimitsSet {
            max_balance: 5 * XLM,
            min_deposit: XLM
        }
        .to_xdr(&f.e, &f.tab)]
    );
    assert_eq!(
        (
            f.client().config().max_balance,
            f.client().config().min_deposit
        ),
        (5 * XLM, XLM)
    );
    for (max, min) in [(5 * XLM, 0), (XLM, 2 * XLM), (XLM, -1)] {
        f.auth(&f.admin, "set_limits", (max, min).into_val(&f.e));
        crate::assert_tab_err!(
            f.client().try_set_limits(&max, &min),
            TabError::InvalidLimits
        );
    }
    f.auth(&f.pauser, "set_limits", (5 * XLM, XLM).into_val(&f.e));
    assert!(f.client().try_set_limits(&(5 * XLM), &XLM).is_err());
}

#[test]
fn set_treasury_is_admin_only() {
    let f = Fixture::new();
    let t = Address::generate(&f.e);
    f.auth(&f.settler, "set_treasury", (t.clone(),).into_val(&f.e));
    assert!(f.client().try_set_treasury(&t).is_err());
    f.auth(&f.admin, "set_treasury", (t.clone(),).into_val(&f.e));
    f.client().set_treasury(&t);
    assert_eq!(
        f.tab_events(),
        std::vec![TreasurySet {
            previous: f.treasury.clone(),
            new: t.clone()
        }
        .to_xdr(&f.e, &f.tab)]
    );
    assert_eq!(f.client().config().treasury, t);
}

#[test]
fn set_acceptor_keeps_current_and_previous() {
    let f = Fixture::new();
    let a0 = public_key(&f.e, &f.acceptor);
    let a1 = public_key(&f.e, &signing_key("a1"));
    let a2 = public_key(&f.e, &signing_key("a2"));
    let set = |pk: &BytesN<32>| {
        f.auth(&f.admin, "set_acceptor", (pk.clone(),).into_val(&f.e));
        f.client().set_acceptor(pk);
    };
    set(&a1);
    assert_eq!(
        f.tab_events(),
        std::vec![AcceptorSet {
            public_key: a1.clone()
        }
        .to_xdr(&f.e, &f.tab)]
    );
    assert_eq!(
        f.client().config().acceptor_keys,
        soroban_sdk::vec![&f.e, a1.clone(), a0.clone()]
    );
    set(&a2);
    assert_eq!(
        f.client().config().acceptor_keys,
        soroban_sdk::vec![&f.e, a2.clone(), a1.clone()]
    );
    set(&a2);
    assert_eq!(
        f.client().config().acceptor_keys,
        soroban_sdk::vec![&f.e, a2.clone(), a2.clone()]
    );
    let zero = BytesN::from_array(&f.e, &[0; 32]);
    f.auth(&f.admin, "set_acceptor", (zero.clone(),).into_val(&f.e));
    crate::assert_tab_err!(f.client().try_set_acceptor(&zero), TabError::InvalidKey);
    f.auth(&f.settler, "set_acceptor", (a0.clone(),).into_val(&f.e));
    assert!(f.client().try_set_acceptor(&a0).is_err());
}

#[test]
fn renounce_admin_is_disabled() {
    // I-26: the admin can never be removed.
    let f = Fixture::new();
    f.auth(&f.admin, "renounce_admin", Vec::new(&f.e));
    crate::assert_tab_err!(
        f.client().try_renounce_admin(),
        TabError::AdminRenounceDisabled
    );
    assert_eq!(f.client().get_admin(), Some(f.admin.clone()));
}

#[test]
fn admin_transfer_is_two_step() {
    let f = Fixture::new();
    let next = Address::generate(&f.e);
    let live_until = f.now() + 100;
    f.auth(
        &f.admin,
        "transfer_admin_role",
        (next.clone(), live_until).into_val(&f.e),
    );
    f.client().transfer_admin_role(&next, &live_until);
    assert_eq!(f.client().get_admin(), Some(f.admin.clone()));
    f.auth(&next, "accept_admin_transfer", Vec::new(&f.e));
    f.client().accept_admin_transfer();
    assert_eq!(f.client().get_admin(), Some(next));
}

#[test]
fn pause_blocks_only_new_funds_and_keys() {
    // I-27: while paused, settle, settle_own, claim, revoke_key, withdraw_start
    // and withdraw still work; deposit, open_session and register_key do not.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = Address::generate(&f.e);
    let voucher = f.voucher(&reader, &w, key_id, &key, XLM);
    let accepted = f.accept(
        &f.voucher(&reader, &w, key_id, &key, 2 * XLM),
        &key,
        &f.acceptor,
    );
    f.pause();
    assert!(f.client().paused());
    // Blocked.
    f.auth_with_transfer(
        &reader,
        "deposit",
        (reader.clone(), XLM).into_val(&f.e),
        XLM,
    );
    assert!(f.client().try_deposit(&reader, &XLM).is_err());
    let pk = public_key(&f.e, &signing_key("p"));
    let until = f.now() + 10;
    f.auth(
        &reader,
        "register_key",
        (reader.clone(), pk.clone(), until, XLM).into_val(&f.e),
    );
    assert!(f
        .client()
        .try_register_key(&reader, &pk, &until, &XLM)
        .is_err());
    f.auth(
        &reader,
        "open_session",
        (reader.clone(), 0i128, pk.clone(), until, XLM).into_val(&f.e),
    );
    assert!(f
        .client()
        .try_open_session(&reader, &0, &pk, &until, &XLM)
        .is_err());
    // Allowed.
    assert_eq!(f.settle(&vec1(&f.e, voucher)).settled, 1);
    assert_eq!(f.settle_own(&w, &vec1(&f.e, accepted)).settled, 1);
    assert!(f.claim(&w) > 0);
    f.auth(
        &reader,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    f.client().revoke_key(&reader, &key_id);
    f.withdraw_start(&reader);
    f.advance(crate::WITHDRAW_DELAY);
    assert_eq!(f.withdraw(&reader), 8 * XLM);
    // Only the admin unpauses; only the pauser pauses.
    f.auth(&f.pauser, "unpause", (f.pauser.clone(),).into_val(&f.e));
    assert!(f.client().try_unpause(&f.pauser).is_err());
    f.unpause();
    assert!(!f.client().paused());
    f.auth(&f.admin, "pause", (f.admin.clone(),).into_val(&f.e));
    assert!(f.client().try_pause(&f.admin).is_err());
}

#[test]
fn migrate_runs_once_per_version() {
    // I-30: migrate fails when the schema is current, runs once from an older
    // version, and is upgrader-only.
    let f = Fixture::new();
    f.auth(&f.upgrader, "migrate", (f.upgrader.clone(),).into_val(&f.e));
    crate::assert_tab_err!(
        f.client().try_migrate(&f.upgrader),
        TabError::AlreadyMigrated
    );
    f.e.as_contract(&f.tab, || upgradeable::set_schema_version(&f.e, 0));
    f.auth(&f.admin, "migrate", (f.admin.clone(),).into_val(&f.e));
    assert!(f.client().try_migrate(&f.admin).is_err());
    f.auth(&f.upgrader, "migrate", (f.upgrader.clone(),).into_val(&f.e));
    f.client().migrate(&f.upgrader);
    assert_eq!(
        f.tab_events(),
        std::vec![Migrated {
            from_version: 0,
            to_version: crate::SCHEMA_VERSION
        }
        .to_xdr(&f.e, &f.tab)]
    );
    assert_eq!(f.client().schema_version(), crate::SCHEMA_VERSION);
    f.auth(&f.upgrader, "migrate", (f.upgrader.clone(),).into_val(&f.e));
    crate::assert_tab_err!(
        f.client().try_migrate(&f.upgrader),
        TabError::AlreadyMigrated
    );
}

#[test]
fn views_for_unknown_entries() {
    let f = Fixture::new();
    let a = Address::generate(&f.e);
    let c = f.client();
    assert_eq!(c.account(&a), None);
    assert_eq!(c.session_key(&a, &0), None);
    assert_eq!(c.paid(&a, &0, &a), 0);
    assert_eq!(c.claimable(&a), 0);
    crate::assert_tab_err!(
        c.try_voucher_payload(&a, &a, &0, &1, &root(&f.e, 1)),
        TabError::KeyNotFound
    );
}
