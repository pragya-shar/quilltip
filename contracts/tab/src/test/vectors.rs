//! Encoding vectors (I-14, I-23).
//!
//! 1. `contract_reproduces_shared_vectors`: for every case in
//!    `shared/test-vectors.json`, the deployed contract's `voucher_payload`
//!    returns exactly `payload_xdr`, and the vector's session and acceptor
//!    signatures settle through `settle` and `settle_own`.
//! 2. `tab_settlement_vectors`: `tab/test-vectors.json` fixes a settlement
//!    sequence (payload bytes, signatures and the expected contract results)
//!    that the TypeScript encoder must reproduce. Regenerate only for an
//!    intended change:
//!    `QUILLTIP_WRITE_TAB_VECTORS=1 cargo test -p quilltip-tab tab_settlement_vectors`,
//!    then `npx prettier --write contracts/tab/test-vectors.json`.
use super::*;
use ed25519_dalek::SigningKey;
use quilltip_shared::fee::tab_fee;
use quilltip_shared::payload::AcceptancePayload;
use serde_json::{json, Value};
use soroban_sdk::{Bytes, String as SorobanString};
use std::string::ToString;

const SHARED: &str = include_str!("../../../shared/test-vectors.json");
const TAB_VECTORS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/test-vectors.json");

fn unhex<const N: usize>(s: &str) -> [u8; N] {
    hex::decode(s).unwrap().try_into().unwrap()
}

fn hex_of(b: &Bytes) -> std::string::String {
    let mut buf = std::vec![0u8; b.len() as usize];
    b.copy_into_slice(&mut buf);
    hex::encode(buf)
}

fn addr(e: &Env, s: &str) -> Address {
    Address::from_string(&SorobanString::from_str(e, s))
}

/// Minimal token for the vector tests. Vector readers are G addresses, which
/// would need a trustline for a test Stellar asset; this token needs none.
#[soroban_sdk::contract]
pub struct VectorToken;

#[soroban_sdk::contractimpl]
impl VectorToken {
    pub fn mint(e: &Env, to: Address, amount: i128) {
        let b: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        e.storage().persistent().set(&to, &(b + amount));
    }

    pub fn balance(e: &Env, id: Address) -> i128 {
        e.storage().persistent().get(&id).unwrap_or(0)
    }

    pub fn transfer(e: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let f: i128 = e.storage().persistent().get(&from).unwrap_or(0);
        let t: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        assert!(f >= amount, "insufficient balance");
        e.storage().persistent().set(&from, &(f - amount));
        e.storage().persistent().set(&to, &(t + amount));
    }
}

fn mint(f: &Fixture, to: &Address, amount: i128) {
    VectorTokenClient::new(&f.e, &f.token).mint(to, &amount);
}

fn shared() -> Value {
    serde_json::from_str(SHARED).unwrap()
}

/// A Tab deployed at the vectors' contract address on the vectors' network.
fn deploy_at_vector_address(v: &Value) -> Fixture {
    let e = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    e.ledger().set_sequence_number(START_LEDGER);
    let base = Fixture::with_env(e);
    let net: [u8; 32] = unhex(v["network"]["network_id"].as_str().unwrap());
    base.e.ledger().set_network_id(net);
    let acceptor = SigningKey::from_bytes(&unhex(v["keys"]["acceptor"]["seed"].as_str().unwrap()));
    let tab = addr(&base.e, v["tab_contract"].as_str().unwrap());
    let token = base.e.register(VectorToken, ());
    base.e.register_at(
        &tab,
        QuillTipTab,
        (
            &base.admin,
            &base.pauser,
            &base.upgrader,
            &base.settler,
            &token,
            &base.treasury,
            MAX_BALANCE,
            MIN_DEPOSIT,
            public_key(&base.e, &acceptor),
        ),
    );
    base.e.mock_all_auths();
    Fixture {
        tab,
        token,
        acceptor,
        all_auths: true,
        ..base
    }
}

#[test]
fn contract_reproduces_shared_vectors() {
    let v = shared();
    let session = SigningKey::from_bytes(&unhex(v["keys"]["session"]["seed"].as_str().unwrap()));
    for case in v["vouchers"].as_array().unwrap() {
        let name = case["case"].as_str().unwrap();
        for own in [false, true] {
            let f = deploy_at_vector_address(&v);
            let reader = addr(&f.e, case["reader"].as_str().unwrap());
            let writer = addr(&f.e, case["writer"].as_str().unwrap());
            mint(&f, &reader, MAX_BALANCE);
            let key_id = f.open_session(&reader, 10 * XLM, &session, f.now() + 100, 10 * XLM);
            assert_eq!(key_id, case["key_id"].as_u64().unwrap() as u32, "{name}");
            let cumulative: i128 = case["cumulative"].as_str().unwrap().parse().unwrap();
            let receipts_root =
                BytesN::from_array(&f.e, &unhex(case["receipts_root"].as_str().unwrap()));
            let payload =
                f.client()
                    .voucher_payload(&reader, &writer, &key_id, &cumulative, &receipts_root);
            assert_eq!(
                hex_of(&payload),
                case["payload_xdr"].as_str().unwrap(),
                "{name}"
            );
            assert_eq!(
                payload.len(),
                case["payload_length"].as_u64().unwrap() as u32,
                "{name}"
            );
            let accept = AcceptancePayload::for_voucher_bytes(&f.e, &payload).to_bytes(&f.e);
            assert_eq!(
                hex_of(&accept),
                case["acceptance_payload_xdr"].as_str().unwrap(),
                "{name}"
            );
            let voucher = Voucher {
                reader: reader.clone(),
                writer: writer.clone(),
                key_id,
                cumulative,
                receipts_root,
                signature: BytesN::from_array(&f.e, &unhex(case["signature"].as_str().unwrap())),
                acceptor: Some(public_key(&f.e, &f.acceptor)),
                acceptance_signature: Some(BytesN::from_array(
                    &f.e,
                    &unhex(case["acceptance_signature"].as_str().unwrap()),
                )),
            };
            let out = if own {
                f.settle_own(&writer, &vec1(&f.e, voucher))
            } else {
                f.settle(&vec1(&f.e, voucher))
            };
            assert_eq!(out.settled, 1, "{name} own={own}");
            assert_eq!(out.fee, tab_fee(0, cumulative).unwrap(), "{name}");
        }
    }
}

/// The settlement sequence fixed in `tab/test-vectors.json`.
fn build_tab_vectors() -> Value {
    let v = shared();
    let f = deploy_at_vector_address(&v);
    let session = SigningKey::from_bytes(&unhex(v["keys"]["session"]["seed"].as_str().unwrap()));
    let case = &v["vouchers"][0];
    let reader = addr(&f.e, case["reader"].as_str().unwrap());
    let writer = addr(&f.e, case["writer"].as_str().unwrap());
    mint(&f, &reader, MAX_BALANCE);
    let deposit = 10 * XLM;
    let key_id = f.open_session(&reader, deposit, &session, f.now() + 100, 10 * XLM);
    let cumulatives: [i128; 5] = [39, 40, 3_900_000, 3_900_039, 12 * XLM];
    let mut steps = std::vec::Vec::new();
    for (i, cumulative) in cumulatives.iter().enumerate() {
        let root_bytes: [u8; 32] = {
            use sha2::{Digest, Sha256};
            Sha256::digest(std::format!("tab-vector-root-{}", i + 1).as_bytes()).into()
        };
        let receipts_root = BytesN::from_array(&f.e, &root_bytes);
        let payload =
            f.client()
                .voucher_payload(&reader, &writer, &key_id, cumulative, &receipts_root);
        let signature = f.sign(&session, &payload);
        let accept = AcceptancePayload::for_voucher_bytes(&f.e, &payload).to_bytes(&f.e);
        let acceptance_signature = f.sign(&f.acceptor, &accept);
        let voucher = Voucher {
            reader: reader.clone(),
            writer: writer.clone(),
            key_id,
            cumulative: *cumulative,
            receipts_root: receipts_root.clone(),
            signature: signature.clone(),
            acceptor: Some(public_key(&f.e, &f.acceptor)),
            acceptance_signature: Some(acceptance_signature.clone()),
        };
        let out = f.settle_own(&writer, &vec1(&f.e, voucher));
        let c = f.client();
        steps.push(json!({
            "step": i + 1,
            "cumulative": cumulative.to_string(),
            "receipts_root": hex::encode(root_bytes),
            "payload_xdr": hex_of(&payload),
            "signature": hex::encode(signature.to_array()),
            "acceptance_payload_xdr": hex_of(&accept),
            "acceptance_signature": hex::encode(acceptance_signature.to_array()),
            "expected": {
                "settled": out.settled,
                "skipped": out.skipped,
                "gross": out.gross.to_string(),
                "fee": out.fee.to_string(),
                "net": (out.gross - out.fee).to_string(),
                "paid_after": c.paid(&reader, &key_id, &writer).to_string(),
                "reader_balance": c.account(&reader).unwrap().balance.to_string(),
                "writer_claimable": c.claimable(&writer).to_string(),
                "treasury_claimable": c.claimable(&f.treasury).to_string(),
            }
        }));
    }
    json!({
        "description": "Tab settlement vectors. A TypeScript encoder must reproduce payload_xdr, signature, acceptance_payload_xdr and acceptance_signature byte for byte; expected holds the contract results of settle_own for each step in order. Keys, addresses and network come from contracts/shared/test-vectors.json (vouchers[0], G/G). Every key is a deterministic test key; never use it on any network.",
        "schema": "quilltip-tab-vectors-v1",
        "spec": "docs/architecture/v2/03-tab-contract.md sections 3.2 and 3.4",
        "tab_contract": v["tab_contract"],
        "network_id": v["network"]["network_id"],
        "reader": case["reader"],
        "writer": case["writer"],
        "key_id": key_id,
        "session_public_key": v["keys"]["session"]["public_key"],
        "acceptor_public_key": v["keys"]["acceptor"]["public_key"],
        "deposit": deposit.to_string(),
        "spend_limit": (10 * XLM).to_string(),
        "steps": steps,
    })
}

#[test]
fn tab_settlement_vectors() {
    let built = build_tab_vectors();
    if std::env::var("QUILLTIP_WRITE_TAB_VECTORS").is_ok() {
        std::fs::write(
            TAB_VECTORS_PATH,
            serde_json::to_string_pretty(&built).unwrap() + "\n",
        )
        .unwrap();
    }
    let text = std::fs::read_to_string(TAB_VECTORS_PATH).expect("tab/test-vectors.json is missing");
    let file: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        file, built,
        "tab/test-vectors.json does not match the contract"
    );
}
