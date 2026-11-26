//! Random voucher batches through `settle` and `settle_own`.
//!
//! After every call: the Tab's token balance equals Σ reader balances plus
//! Σ claimable (I-10); `Paid` never decreases and never exceeds the highest
//! validly signed cumulative (I-11); spending never exceeds the key limit (I-12);
//! fees credited equal Σ floor(Paid × 250 / 10,000) (I-31). After the settle
//! deadline the temporary entries expire and nothing settles (I-15, I-29).
#![no_main]

use arbitrary::Arbitrary;
use ed25519_dalek::{Signer, SigningKey};
use libfuzzer_sys::fuzz_target;
use quilltip_shared::fee::fee;
use quilltip_shared::payload::{AcceptancePayload, VoucherPayload};
use quilltip_tab::{QuillTipTab, QuillTipTabClient, Voucher, SETTLE_GRACE};
use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};

const READERS: usize = 2;
const WRITERS: usize = 2;
const XLM: i128 = 10_000_000;
const KEY_LIFETIME: u32 = 100_000;

#[derive(Arbitrary, Debug)]
struct Item {
    reader: u8,
    writer: u8,
    key_id: u8,
    cumulative: i128,
    valid_signature: bool,
    accepted: bool,
    tamper: u8,
}

#[derive(Arbitrary, Debug)]
struct Call {
    own: bool,
    advance: u16,
    items: std::vec::Vec<Item>,
}

fn key(i: usize) -> SigningKey {
    use sha2::{Digest, Sha256};
    SigningKey::from_bytes(&Sha256::digest(format!("fuzz-{i}").as_bytes()).into())
}

fn sign(e: &Env, k: &SigningKey, b: &Bytes) -> BytesN<64> {
    let mut buf = std::vec![0u8; b.len() as usize];
    b.copy_into_slice(&mut buf);
    BytesN::from_array(e, &k.sign(&buf).to_bytes())
}

fuzz_target!(|calls: std::vec::Vec<Call>| {
    let e = Env::new_with_config(EnvTestConfig { capture_snapshot_at_drop: false });
    e.mock_all_auths();
    e.ledger().set_sequence_number(1_000);
    let issuer = Address::generate(&e);
    let token = e.register_stellar_asset_contract_v2(issuer).address();
    let a = Address::generate(&e);
    let settler = Address::generate(&e);
    let treasury = Address::generate(&e);
    let acceptor = key(99);
    let acceptor_pk = BytesN::from_array(&e, &acceptor.verifying_key().to_bytes());
    let tab = e.register(
        QuillTipTab,
        (&a, &a, &a, &settler, &token, &treasury, 1_000 * XLM, XLM, acceptor_pk.clone()),
    );
    let c = QuillTipTabClient::new(&e, &tab);
    let readers: std::vec::Vec<Address> = (0..READERS).map(|_| Address::generate(&e)).collect();
    let writers: std::vec::Vec<Address> = (0..WRITERS).map(|_| Address::generate(&e)).collect();
    for (i, r) in readers.iter().enumerate() {
        StellarAssetClient::new(&e, &token).mint(r, &(100 * XLM));
        let pk = BytesN::from_array(&e, &key(i).verifying_key().to_bytes());
        c.open_session(r, &(10 * XLM), &pk, &(e.ledger().sequence() + KEY_LIFETIME), &(8 * XLM));
    }
    // Last ledger a voucher can settle; after it `Session` and `Paid` expire (I-29).
    let deadline = e.ledger().sequence() + KEY_LIFETIME + SETTLE_GRACE;
    let mut max_signed = [[0i128; WRITERS]; READERS];
    let mut last_paid = [[0i128; WRITERS]; READERS];
    for call in calls.iter().take(8) {
        e.ledger().set_sequence_number(e.ledger().sequence() + u32::from(call.advance));
        let writer_for_own = writers[0].clone();
        let mut batch = Vec::new(&e);
        for it in call.items.iter().take(8) {
            let r = it.reader as usize % READERS;
            let w = if call.own { 0 } else { it.writer as usize % WRITERS };
            let kid = u32::from(it.key_id % 2);
            let root = BytesN::from_array(&e, &[it.tamper; 32]);
            let payload = VoucherPayload::new(
                &e, tab.clone(), e.ledger().network_id(), readers[r].clone(), writers[w].clone(),
                kid, BytesN::from_array(&e, &key(r).verifying_key().to_bytes()), it.cumulative, root.clone(),
            )
            .to_bytes(&e);
            let signature = if it.valid_signature {
                sign(&e, &key(r), &payload)
            } else {
                BytesN::from_array(&e, &[it.tamper; 64])
            };
            if it.valid_signature && kid == 0 {
                max_signed[r][w] = max_signed[r][w].max(it.cumulative);
            }
            let (acc, acc_sig) = if it.accepted {
                let ap = AcceptancePayload::for_voucher_bytes(&e, &payload).to_bytes(&e);
                (Some(acceptor_pk.clone()), Some(sign(&e, &acceptor, &ap)))
            } else {
                (None, None)
            };
            batch.push_back(Voucher {
                reader: readers[r].clone(), writer: writers[w].clone(), key_id: kid,
                cumulative: it.cumulative, receipts_root: root, signature,
                acceptor: acc, acceptance_signature: acc_sig,
            });
        }
        let _ = if call.own {
            c.try_settle_own(&writer_for_own, &batch).is_ok()
        } else {
            c.try_settle(&settler, &batch).is_ok()
        };
        // Invariants after every call.
        let held: i128 = readers.iter().map(|r| c.account(r).map(|x| x.balance).unwrap_or(0)).sum::<i128>()
            + writers.iter().map(|w| c.claimable(w)).sum::<i128>()
            + c.claimable(&treasury);
        assert_eq!(TokenClient::new(&e, &token).balance(&tab), held);
        let expired = e.ledger().sequence() > deadline;
        let mut fees = 0;
        for r in 0..READERS {
            let mut spent = 0;
            for w in 0..WRITERS {
                let paid = c.paid(&readers[r], &0, &writers[w]);
                if expired {
                    // The entry has expired, so the view reads 0; nothing settles any more.
                    assert!(paid == 0 || paid == last_paid[r][w]);
                    assert!(c.session_key(&readers[r], &0).is_none());
                } else {
                    assert!(paid >= last_paid[r][w]);
                    assert!(paid <= max_signed[r][w].max(0));
                    last_paid[r][w] = paid;
                }
                let paid = last_paid[r][w];
                fees += fee(paid).unwrap();
                spent += paid;
            }
            if let Some(k) = c.session_key(&readers[r], &0) {
                assert_eq!(k.spent, spent);
                assert!(k.spent <= k.spend_limit);
            }
        }
        assert_eq!(c.claimable(&treasury), fees);
    }
});
