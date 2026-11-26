//! Shared encoding vectors (I-14, I-23).
//!
//! `contracts/shared/test-vectors.json` fixes identifiers, voucher and
//! acceptance payload bytes, signatures, receipt leaves, Merkle roots and
//! proofs. Rust, Convex and the client all check the same file.
//!
//! This test recomputes every value from deterministic inputs and compares it
//! with the committed file. It also verifies every signature and proof read
//! from the file. To regenerate after an intended encoding change:
//!
//! ```text
//! QUILLTIP_WRITE_TEST_VECTORS=1 cargo test -p quilltip-shared --test test_vectors
//! npx prettier --write contracts/shared/test-vectors.json
//! ```

use ed25519_dalek::{Signer, SigningKey, Verifier as _, VerifyingKey};
use quilltip_shared::{
    ids, merkle, AcceptancePayload, TipReceipt, VoucherPayload, MAX_RECEIPTS_PER_PAIR,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};
use stellar_contract_utils::crypto::{merkle::Verifier, sha256::Sha256 as OzSha256};
use stellar_strkey::{ed25519, Contract, Strkey};

const VECTORS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/test-vectors.json");
const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";

const ARTICLE_CONVEX_IDS: [&str; 2] = [
    "j57a3k9w8m2x4p6q1r5t7v9y0z3b8c2d",
    "k1792f0e6zq8t4v2w9x3y5b7n1m6p0r4",
];

const HIGHLIGHT_SOURCES: [&str; 2] = [
    "on-writing-well:120:163:The quick brown fox jumps over the lazy dog",
    "café-notes:7:31:Grüße aus Zürich, naïve résumé ✓",
];

fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

fn seed(label: &str) -> [u8; 32] {
    sha256(format!("quilltip:test-vectors:{label}").as_bytes())
}

fn account_strkey(signing: &SigningKey) -> String {
    Strkey::PublicKeyEd25519(ed25519::PublicKey(signing.verifying_key().to_bytes()))
        .to_string()
        .as_str()
        .to_owned()
}

fn contract_strkey(label: &str) -> String {
    Strkey::Contract(Contract(seed(label)))
        .to_string()
        .as_str()
        .to_owned()
}

fn b64url_encode(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..=chunk.len() {
            out.push(A[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

fn b64url_decode(text: &str) -> std::vec::Vec<u8> {
    let val = |c: u8| -> u32 {
        match c {
            b'A'..=b'Z' => u32::from(c - b'A'),
            b'a'..=b'z' => u32::from(c - b'a') + 26,
            b'0'..=b'9' => u32::from(c - b'0') + 52,
            b'-' => 62,
            b'_' => 63,
            _ => panic!("invalid base64url character"),
        }
    };
    let mut out = std::vec::Vec::new();
    for chunk in text.as_bytes().chunks(4) {
        let mut n = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            n |= val(*c) << (18 - 6 * i);
        }
        for i in 0..chunk.len() - 1 {
            out.push((n >> (16 - 8 * i)) as u8);
        }
    }
    out
}

fn to_vec(bytes: &Bytes) -> std::vec::Vec<u8> {
    let mut out = std::vec![0u8; bytes.len() as usize];
    bytes.copy_into_slice(&mut out);
    out
}

fn hex_of(bytes: &Bytes) -> String {
    hex::encode(to_vec(bytes))
}

fn hex32(bytes: &BytesN<32>) -> String {
    hex::encode(bytes.to_array())
}

fn bytes32(e: &Env, data: [u8; 32]) -> BytesN<32> {
    BytesN::from_array(e, &data)
}

struct Fixture {
    e: Env,
    network_id: BytesN<32>,
    tab: String,
    reader_g: String,
    writer_g: String,
    reader_c: String,
    writer_c: String,
    session: SigningKey,
    acceptor: SigningKey,
}

impl Fixture {
    fn new() -> Self {
        let e = Env::default();
        Fixture {
            network_id: bytes32(&e, sha256(TESTNET_PASSPHRASE.as_bytes())),
            tab: contract_strkey("tab-contract"),
            reader_g: account_strkey(&SigningKey::from_bytes(&seed("reader-account"))),
            writer_g: account_strkey(&SigningKey::from_bytes(&seed("writer-account"))),
            reader_c: contract_strkey("reader-contract"),
            writer_c: contract_strkey("writer-contract"),
            session: SigningKey::from_bytes(&seed("session-key")),
            acceptor: SigningKey::from_bytes(&seed("acceptor-key")),
            e,
        }
    }

    fn receipts(&self) -> std::vec::Vec<TipReceipt> {
        let e = &self.e;
        let article = ids::article_id(e, &Bytes::from_slice(e, ARTICLE_CONVEX_IDS[0].as_bytes()));
        let content = bytes32(e, seed("content-hash-1"));
        let highlight =
            ids::highlight_id(e, &Bytes::from_slice(e, HIGHLIGHT_SOURCES[0].as_bytes()));
        let amounts: [i128; 3] = [1_000_000, 2_500_000, 400_000];
        let mut cumulative = 0;
        amounts
            .iter()
            .enumerate()
            .map(|(i, amount)| {
                cumulative += amount;
                let mut client_ref = [0u8; 16];
                client_ref.copy_from_slice(&seed(&format!("client-ref-{}", i + 1))[..16]);
                TipReceipt {
                    amount: *amount,
                    article_id: article.clone(),
                    client_ref: BytesN::from_array(e, &client_ref),
                    content_hash: content.clone(),
                    cumulative_after: cumulative,
                    highlight_id: if i == 1 {
                        Some(highlight.clone())
                    } else {
                        None
                    },
                    seq: (i + 1) as u32,
                }
            })
            .collect()
    }
}

fn receipt_json(r: &TipReceipt, e: &Env) -> Value {
    json!({
        "seq": r.seq,
        "amount": r.amount.to_string(),
        "cumulative_after": r.cumulative_after.to_string(),
        "article_id": hex32(&r.article_id),
        "client_ref": hex::encode(r.client_ref.to_array()),
        "content_hash": hex32(&r.content_hash),
        "highlight_id": r.highlight_id.as_ref().map(hex32),
        "xdr": hex_of(&r.to_bytes(e)),
        "leaf": hex32(&merkle::receipt_leaf(e, r)),
    })
}

fn build_vectors(f: &Fixture) -> Value {
    let e = &f.e;

    let article_ids: std::vec::Vec<Value> = ARTICLE_CONVEX_IDS
        .iter()
        .map(|id| {
            let derived = ids::article_id(e, &Bytes::from_slice(e, id.as_bytes()));
            json!({ "convex_id": id, "article_id": hex32(&derived) })
        })
        .collect();

    let highlight_ids: std::vec::Vec<Value> = HIGHLIGHT_SOURCES
        .iter()
        .map(|src| {
            let digest = ids::highlight_id(e, &Bytes::from_slice(e, src.as_bytes()));
            let full = hex32(&digest);
            json!({ "source": src, "highlight_id": full, "v1_convex_id": &full[..28] })
        })
        .collect();

    let arweave_ids: std::vec::Vec<Value> = (1..=2)
        .map(|n| {
            let raw = seed(&format!("arweave-{n}"));
            json!({ "tx_id": b64url_encode(&raw), "arweave_id": hex::encode(raw) })
        })
        .collect();

    let receipts = f.receipts();
    let mut leaves = Vec::new(e);
    for r in &receipts {
        leaves.push_back(merkle::receipt_leaf(e, r));
    }
    let roots: std::vec::Vec<Value> = (1..=leaves.len())
        .map(|n| {
            let prefix = leaves.slice(0..n);
            json!({ "count": n, "root": hex32(&merkle::merkle_root(e, &prefix).unwrap()) })
        })
        .collect();
    let proofs: std::vec::Vec<Value> = (0..leaves.len())
        .map(|i| {
            let proof = merkle::merkle_proof(e, &leaves, i).unwrap();
            json!({
                "count": leaves.len(),
                "index": i,
                "proof": proof.iter().map(|p| hex32(&p)).collect::<std::vec::Vec<_>>(),
            })
        })
        .collect();
    let root = merkle::merkle_root(e, &leaves).unwrap();
    let cumulative = receipts.last().unwrap().cumulative_after;

    let public_key = bytes32(e, f.session.verifying_key().to_bytes());
    let pairs = [
        ("G/G", &f.reader_g, &f.writer_g),
        ("G/C", &f.reader_g, &f.writer_c),
        ("C/C", &f.reader_c, &f.writer_c),
    ];
    let vouchers: std::vec::Vec<Value> = pairs
        .iter()
        .map(|(case, reader, writer)| {
            let payload = VoucherPayload::new(
                e,
                Address::from_str(e, &f.tab),
                f.network_id.clone(),
                Address::from_str(e, reader),
                Address::from_str(e, writer),
                0,
                public_key.clone(),
                cumulative,
                root.clone(),
            );
            let bytes = to_vec(&payload.to_bytes(e));
            let acceptance = AcceptancePayload::for_voucher_bytes(e, &payload.to_bytes(e));
            let acceptance_bytes = to_vec(&acceptance.to_bytes(e));
            json!({
                "case": case,
                "reader": reader,
                "writer": writer,
                "key_id": 0,
                "cumulative": cumulative.to_string(),
                "receipts_root": hex32(&root),
                "payload_xdr": hex::encode(&bytes),
                "payload_length": bytes.len(),
                "payload_sha256": hex::encode(sha256(&bytes)),
                "signature": hex::encode(f.session.sign(&bytes).to_bytes()),
                "acceptance_payload_xdr": hex::encode(&acceptance_bytes),
                "acceptance_signature": hex::encode(f.acceptor.sign(&acceptance_bytes).to_bytes()),
            })
        })
        .collect();

    json!({
        "schema": "quilltip-test-vectors-v1",
        "description": "Shared encoding vectors for the QuillTip v2 contracts, Convex and the client. Every key below is a deterministic test key; never use it on any network.",
        "network": {
            "passphrase": TESTNET_PASSPHRASE,
            "network_id": hex32(&f.network_id),
        },
        "identifiers": {
            "article_id_prefix": quilltip_shared::ARTICLE_ID_PREFIX,
            "article_ids": article_ids,
            "highlight_ids": highlight_ids,
            "arweave_ids": arweave_ids,
        },
        "canonical_articles": {
            "status": "pending: added by the canonical article bytes issue",
            "cases": [],
        },
        "keys": {
            "session": {
                "seed": hex::encode(seed("session-key")),
                "public_key": hex::encode(f.session.verifying_key().to_bytes()),
            },
            "acceptor": {
                "seed": hex::encode(seed("acceptor-key")),
                "public_key": hex::encode(f.acceptor.verifying_key().to_bytes()),
            },
        },
        "tab_contract": f.tab,
        "receipts": {
            "reader": f.reader_g,
            "writer": f.writer_g,
            "key_id": 0,
            "max_receipts_per_pair": MAX_RECEIPTS_PER_PAIR,
            "items": receipts.iter().map(|r| receipt_json(r, e)).collect::<std::vec::Vec<_>>(),
            "roots": roots,
            "proofs": proofs,
        },
        "vouchers": vouchers,
    })
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key]
        .as_str()
        .unwrap_or_else(|| panic!("missing string {key}"))
}

fn bytes_of(v: &Value, key: &str) -> std::vec::Vec<u8> {
    hex::decode(str_of(v, key)).unwrap()
}

/// Checks the committed file on its own terms: signatures, proofs, identifier
/// decodings and payload framing.
fn verify_file_contents(file: &Value) {
    let e = Env::default();

    for a in file["identifiers"]["arweave_ids"].as_array().unwrap() {
        let tx = str_of(a, "tx_id");
        assert_eq!(tx.len(), 43);
        assert_eq!(b64url_decode(tx), bytes_of(a, "arweave_id"));
    }
    for h in file["identifiers"]["highlight_ids"].as_array().unwrap() {
        assert!(str_of(h, "highlight_id").starts_with(str_of(h, "v1_convex_id")));
        assert_eq!(str_of(h, "v1_convex_id").len(), 28);
    }

    let session_pk = bytes_of(&file["keys"]["session"], "public_key");
    let acceptor_pk = bytes_of(&file["keys"]["acceptor"], "public_key");
    let session_vk = VerifyingKey::from_bytes(&session_pk.clone().try_into().unwrap()).unwrap();
    let acceptor_vk = VerifyingKey::from_bytes(&acceptor_pk.clone().try_into().unwrap()).unwrap();

    let mut lengths = std::collections::BTreeMap::new();
    for v in file["vouchers"].as_array().unwrap() {
        let payload = bytes_of(v, "payload_xdr");
        assert_eq!(&payload[..12], &[0, 0, 0, 0x11, 0, 0, 0, 1, 0, 0, 0, 9]);
        assert_eq!(payload.len() as u64, v["payload_length"].as_u64().unwrap());
        lengths.insert(str_of(v, "case").to_string(), payload.len());

        let sig: [u8; 64] = bytes_of(v, "signature").try_into().unwrap();
        session_vk
            .verify(&payload, &ed25519_dalek::Signature::from_bytes(&sig))
            .expect("session signature");
        e.crypto().ed25519_verify(
            &BytesN::from_array(&e, &session_pk.clone().try_into().unwrap()),
            &Bytes::from_slice(&e, &payload),
            &BytesN::from_array(&e, &sig),
        );

        let accept = bytes_of(v, "acceptance_payload_xdr");
        let expected =
            AcceptancePayload::for_voucher_bytes(&e, &Bytes::from_slice(&e, &payload)).to_bytes(&e);
        assert_eq!(accept, to_vec(&expected));
        let asig: [u8; 64] = bytes_of(v, "acceptance_signature").try_into().unwrap();
        acceptor_vk
            .verify(&accept, &ed25519_dalek::Signature::from_bytes(&asig))
            .expect("acceptance signature");
    }
    // An account address encodes 4 bytes longer than a contract address.
    assert_eq!(lengths["G/G"], lengths["C/C"] + 8);
    assert_eq!(lengths["G/C"], lengths["C/C"] + 4);

    let receipts = &file["receipts"];
    let items = receipts["items"].as_array().unwrap();
    let root_all = receipts["roots"].as_array().unwrap().last().unwrap();
    let root = BytesN::from_array(&e, &bytes_of(root_all, "root").try_into().unwrap());
    for (item, p) in items.iter().zip(receipts["proofs"].as_array().unwrap()) {
        let xdr = bytes_of(item, "xdr");
        let leaf = sha256(&sha256(&xdr));
        assert_eq!(leaf.to_vec(), bytes_of(item, "leaf"));
        let mut proof = Vec::new(&e);
        for h in p["proof"].as_array().unwrap() {
            let raw: [u8; 32] = hex::decode(h.as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap();
            proof.push_back(BytesN::from_array(&e, &raw));
        }
        assert!(Verifier::<OzSha256>::verify(
            &e,
            proof,
            root.clone(),
            BytesN::from_array(&e, &leaf)
        ));
    }
}

#[test]
fn test_vectors_match_the_encoders() {
    let fixture = Fixture::new();
    let expected = build_vectors(&fixture);

    if std::env::var_os("QUILLTIP_WRITE_TEST_VECTORS").is_some() {
        let text = serde_json::to_string_pretty(&expected).unwrap() + "\n";
        std::fs::write(VECTORS_PATH, text).unwrap();
    }

    let committed: Value = serde_json::from_str(
        &std::fs::read_to_string(VECTORS_PATH).expect("test-vectors.json is missing"),
    )
    .expect("test-vectors.json is not valid JSON");
    verify_file_contents(&committed);
    assert!(
        committed == expected,
        "test-vectors.json differs from the encoders. Regenerate it only for an intended \
         encoding change (see the header of this test)."
    );
}
