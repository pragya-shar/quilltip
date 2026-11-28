//! Upgrade and migrate (I-28 does not apply to Core; I-30).
//!
//! Deploys the CLI-built v1 Wasm, writes state, upgrades to a test v2 Wasm
//! built with the `upgrade-test` feature (schema version 2, one added view),
//! then migrates. Repeats through an upgrader contract that runs upgrade and
//! migrate in one transaction. Ignored unless `QUILLTIP_WASM_DIR` holds
//! `quilltip_core.wasm` and `quilltip_core_upgrade_test.wasm`.

use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, BytesN, Env, IntoVal, Symbol,
};

use super::*;
use crate::{CoreError, TokenConfig};

/// Test-only upgrader: upgrade and migrate in one invocation, as in the
/// OpenZeppelin `examples/upgradeable/upgrader` pattern.
#[contract]
pub struct TestUpgrader;

#[contractimpl]
impl TestUpgrader {
    pub fn upgrade_and_migrate(e: Env, core: Address, wasm_hash: BytesN<32>) {
        let client = QuillTipCoreClient::new(&e, &core);
        let me = e.current_contract_address();
        client.upgrade(&wasm_hash, &me);
        client.migrate(&me);
    }
}

struct State {
    id: BytesN<32>,
    author: Address,
    tipper: Address,
    second: Address,
}

/// Writes every kind of Core state through the v1 code.
fn write_state(f: &Fixture) -> State {
    let (id, recipients) = f.article_with_splits(&[6_000, 4_000]);
    f.core
        .update_content(&id, &hash(&f.e, 3), &Some(hash(&f.e, 4)));
    let tipper = f.funded();
    f.core.tip(
        &tipper,
        &id,
        &f.token,
        &(5 * MIN_TIP),
        &None,
        &client_ref(&f.e, 1),
    );
    let second = f.new_token();
    f.core.set_token(&second, &(2 * MIN_TIP), &false);
    State {
        id,
        author: recipients[0].clone(),
        tipper,
        second,
    }
}

/// I-30: every stored value reads back unchanged under the new code.
fn assert_state(f: &Fixture, s: &State) {
    let record = f.core.get_article(&s.id).unwrap();
    assert_eq!(record.author, s.author);
    assert_eq!(record.content_hash, hash(&f.e, 3));
    assert_eq!(record.arweave_id, Some(hash(&f.e, 4)));
    assert_eq!(record.content_version, 2);
    assert_eq!(record.splits.len(), 2);
    assert_eq!(record.registered_ledger, START_LEDGER);
    assert_eq!(f.core.article_total(&s.id, &f.token), 5 * MIN_TIP);
    assert_eq!(f.core.treasury(), f.treasury);
    assert_eq!(
        f.core.token_config(&s.second),
        Some(TokenConfig {
            min_tip: 2 * MIN_TIP,
            enabled: false
        })
    );
    assert_eq!(f.core.get_admin(), Some(f.admin.clone()));
    assert!(f
        .core
        .has_role(&f.pauser, &Symbol::new(&f.e, "pauser"))
        .is_some());
    // The client reference written under v1 still blocks a duplicate.
    assert_core_err!(
        f.core.try_tip(
            &s.tipper,
            &s.id,
            &f.token,
            &MIN_TIP,
            &None,
            &client_ref(&f.e, 1)
        ),
        CoreError::DuplicateClientRef
    );
    // Tipping keeps working and the total keeps growing.
    f.core.tip(
        &s.tipper,
        &s.id,
        &f.token,
        &MIN_TIP,
        &None,
        &client_ref(&f.e, 2),
    );
    assert_eq!(f.core.article_total(&s.id, &f.token), 6 * MIN_TIP);
}

fn marker(f: &Fixture) -> u32 {
    f.e.invoke_contract(
        &f.id(),
        &Symbol::new(&f.e, "upgrade_test_marker"),
        soroban_sdk::vec![&f.e],
    )
}

#[test]
#[ignore = "needs QUILLTIP_WASM_DIR with quilltip_core.wasm and quilltip_core_upgrade_test.wasm"]
fn upgrade_then_migrate_preserves_state() {
    let v1 = wasm_file("quilltip_core.wasm");
    let v2 = wasm_file("quilltip_core_upgrade_test.wasm");
    let f = Fixture::deploy(Some(&v1));
    let s = write_state(&f);
    assert_eq!(f.core.schema_version(), 1);
    // v1 has nothing to migrate.
    assert_core_err!(f.core.try_migrate(&f.upgrader), CoreError::AlreadyMigrated);

    let v2_hash = f.e.deployer().upload_contract_wasm(v2.as_slice());
    // Only the upgrader may upgrade.
    assert_eq!(
        f.core.try_upgrade(&v2_hash, &f.admin).err(),
        Some(contract_err(UNAUTHORIZED))
    );
    f.core.upgrade(&v2_hash, &f.upgrader);
    assert_eq!(marker(&f), 2);
    // Between upgrade and migrate the new code reads the old state.
    assert_eq!(f.core.schema_version(), 1);
    assert_eq!(f.core.article_author(&s.id), s.author);

    f.core.migrate(&f.upgrader);
    assert_eq!(f.core.schema_version(), 2);
    assert_core_err!(f.core.try_migrate(&f.upgrader), CoreError::AlreadyMigrated);
    assert_state(&f, &s);
}

#[test]
#[ignore = "needs QUILLTIP_WASM_DIR with quilltip_core.wasm and quilltip_core_upgrade_test.wasm"]
fn upgrader_contract_upgrades_and_migrates_atomically() {
    let v1 = wasm_file("quilltip_core.wasm");
    let v2 = wasm_file("quilltip_core_upgrade_test.wasm");
    let f = Fixture::deploy(Some(&v1));
    let s = write_state(&f);

    let upgrader_contract = f.e.register(TestUpgrader, ());
    f.core.grant_role(
        &upgrader_contract,
        &Symbol::new(&f.e, "upgrader"),
        &f.upgrader,
    );
    let v2_hash = f.e.deployer().upload_contract_wasm(v2.as_slice());
    f.e.invoke_contract::<()>(
        &upgrader_contract,
        &Symbol::new(&f.e, "upgrade_and_migrate"),
        (f.id(), v2_hash).into_val(&f.e),
    );
    assert_eq!(marker(&f), 2);
    assert_eq!(f.core.schema_version(), 2);
    assert_core_err!(f.core.try_migrate(&f.upgrader), CoreError::AlreadyMigrated);
    assert_state(&f, &s);
    let _ = Address::generate(&f.e);
}
