//! `upgrade` and `migrate` (I-26, I-30).

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    xdr::{
        ContractExecutable, Hash, LedgerEntryData, Limits, ScAddress, ScEnvMetaEntry,
        ScEnvMetaEntryInterfaceVersion, ScVal, WriteXdr,
    },
    Address, Bytes, BytesN, Env, IntoVal,
};
use stellar_access::access_control::AccessControlError;
use stellar_contract_utils::upgradeable;

use super::{assert_fails, auth_error, setup, THRESHOLD};
use crate::{NftError, SCHEMA_VERSION};

/// The smallest Wasm module the host accepts as contract code: no functions,
/// only the `contractenvmetav0` section naming this ledger's protocol.
fn minimal_wasm(e: &Env) -> Bytes {
    let meta = ScEnvMetaEntry::ScEnvMetaKindInterfaceVersion(ScEnvMetaEntryInterfaceVersion {
        protocol: e.ledger().get().protocol_version,
        pre_release: 0,
    })
    .to_xdr(Limits::none())
    .unwrap();
    let name = b"contractenvmetav0";
    let mut section = std::vec![name.len() as u8];
    section.extend_from_slice(name);
    section.extend_from_slice(&meta);
    let mut wasm = std::vec![0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00];
    assert!(section.len() < 0x80);
    wasm.push(section.len() as u8);
    wasm.extend_from_slice(&section);
    Bytes::from_slice(e, &wasm)
}

/// The executable currently recorded in the contract's instance entry.
fn executable_of(e: &Env, contract: &Address) -> ContractExecutable {
    let target = ScAddress::from(contract);
    for (_, (entry, _)) in e.to_ledger_snapshot().ledger_entries {
        if let LedgerEntryData::ContractData(data) = entry.data {
            if data.contract == target && data.key == ScVal::LedgerKeyContractInstance {
                if let ScVal::ContractInstance(instance) = data.val {
                    return instance.executable;
                }
            }
        }
    }
    panic!("no instance entry");
}

#[test]
fn upgrader_upgrades_and_state_is_kept() {
    let s = setup();
    let token_id = s.mint_default();
    let hash: BytesN<32> = s.e.deployer().upload_contract_wasm(minimal_wasm(&s.e));

    s.allow(
        &s.upgrader,
        "upgrade",
        (hash.clone(), s.upgrader.clone()).into_val(&s.e),
    );
    s.nft.upgrade(&hash, &s.upgrader);

    assert_eq!(
        executable_of(&s.e, &s.nft.address),
        ContractExecutable::Wasm(Hash(hash.to_array()))
    );
    // Stored state survives the code change (I-30).
    s.e.as_contract(&s.nft.address, || {
        assert_eq!(upgradeable::get_schema_version(&s.e), SCHEMA_VERSION);
        assert_eq!(crate::storage::threshold(&s.e), (s.xlm.clone(), THRESHOLD));
        assert_eq!(
            crate::storage::token_of_article(&s.e, &s.article),
            Some(token_id)
        );
        assert_eq!(
            stellar_tokens::non_fungible::Base::owner_of(&s.e, token_id),
            s.author
        );
    });
}

#[test]
fn upgrade_needs_the_upgrader() {
    let s = setup();
    let hash: BytesN<32> = s.e.deployer().upload_contract_wasm(minimal_wasm(&s.e));
    for who in [s.admin.clone(), s.pauser.clone()] {
        s.allow(&who, "upgrade", (hash.clone(), who.clone()).into_val(&s.e));
        assert_fails(
            s.nft.try_upgrade(&hash, &who),
            AccessControlError::Unauthorized,
        );
    }
    // The upgrader named as operator must sign.
    s.allow(
        &s.admin,
        "upgrade",
        (hash.clone(), s.upgrader.clone()).into_val(&s.e),
    );
    assert_fails(s.nft.try_upgrade(&hash, &s.upgrader), auth_error());
}

#[test]
fn migrate_at_the_current_version_fails() {
    let s = setup();
    s.allow(&s.upgrader, "migrate", (s.upgrader.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_migrate(&s.upgrader), NftError::AlreadyMigrated);
}

#[test]
fn migrate_runs_once_per_version() {
    let s = setup();
    // State written by an older code version.
    s.e.as_contract(&s.nft.address, || {
        upgradeable::set_schema_version(&s.e, SCHEMA_VERSION - 1)
    });

    let other = Address::generate(&s.e);
    s.allow(&other, "migrate", (other.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_migrate(&other), AccessControlError::Unauthorized);

    s.allow(&s.upgrader, "migrate", (s.upgrader.clone(),).into_val(&s.e));
    s.nft.migrate(&s.upgrader);
    assert_eq!(s.nft.schema_version(), SCHEMA_VERSION);

    s.allow(&s.upgrader, "migrate", (s.upgrader.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_migrate(&s.upgrader), NftError::AlreadyMigrated);
}
