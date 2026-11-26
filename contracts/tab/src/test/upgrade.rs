//! Upgrade path (I-30, I-26). The fixture `testdata/upgrade_probe.wasm` is this
//! crate built with `--features upgrade-probe`; it reads Tab storage after the upgrade.
use super::*;
use soroban_sdk::{Bytes, Symbol};

const PROBE_WASM: &[u8] = include_bytes!("../../testdata/upgrade_probe.wasm");

fn call<T: soroban_sdk::TryFromVal<Env, Val>>(f: &Fixture, name: &str, args: Vec<Val>) -> T {
    f.e.invoke_contract(&f.tab, &Symbol::new(&f.e, name), args)
}

#[test]
fn upgrade_preserves_state_and_schema() {
    // I-30: state written before the upgrade is read unchanged by the new code.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(5 * XLM, 5 * XLM);
    let writer = Address::generate(&f.e);
    f.settle(&vec1(
        &f.e,
        f.voucher(&reader, &writer, key_id, &key, 2 * XLM),
    ));
    let cfg_before = f.client().config();

    let hash =
        f.e.deployer()
            .upload_contract_wasm(Bytes::from_slice(&f.e, PROBE_WASM));
    f.auth(
        &f.upgrader,
        "upgrade",
        (hash.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    f.client().upgrade(&hash, &f.upgrader);

    let schema: u32 = call(&f, "probe_schema_version", Vec::new(&f.e));
    assert_eq!(schema, crate::SCHEMA_VERSION);
    let balance: i128 = call(&f, "probe_balance", (reader.clone(),).into_val(&f.e));
    assert_eq!(balance, 3 * XLM);
    let next: u32 = call(&f, "probe_next_key_id", (reader.clone(),).into_val(&f.e));
    assert_eq!(next, 1);
    let owed: i128 = call(&f, "probe_claimable", (writer.clone(),).into_val(&f.e));
    assert_eq!(owed, 2 * XLM - 2 * XLM * 250 / 10_000);
    let cfg: crate::TabConfig = call(&f, "probe_config", Vec::new(&f.e));
    assert_eq!(cfg, cfg_before);
}

#[test]
fn upgrade_requires_the_upgrader_role() {
    // I-26: only the upgrader may replace the code.
    let f = Fixture::new();
    let hash =
        f.e.deployer()
            .upload_contract_wasm(Bytes::from_slice(&f.e, PROBE_WASM));
    for who in [f.admin.clone(), f.settler.clone(), f.pauser.clone()] {
        f.auth(&who, "upgrade", (hash.clone(), who.clone()).into_val(&f.e));
        assert!(f.client().try_upgrade(&hash, &who).is_err());
    }
    // The upgrader without its own authorisation is refused too.
    f.auth(
        &f.admin,
        "upgrade",
        (hash.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    assert!(f.client().try_upgrade(&hash, &f.upgrader).is_err());
}
