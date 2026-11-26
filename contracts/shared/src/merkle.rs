//! Receipt leaves and Merkle trees (`03-tab-contract.md`, section 3.6).
//!
//! - Leaf: `SHA-256(SHA-256(xdr(TipReceipt)))`. The double hash keeps a
//!   64-byte leaf from being read as an inner node.
//! - Tree: leaves in `seq` order; adjacent pairs hash as
//!   `SHA-256(min(a, b) ‖ max(a, b))` (OpenZeppelin `commutative_hash_pair`);
//!   an odd final node is carried up unchanged; one leaf is its own root.
//! - Proofs verify with OpenZeppelin `crypto::merkle::Verifier<Sha256>`.
//!   A verifier recomputes the leaf from the receipt and never accepts a leaf
//!   hash from a third party.

use soroban_sdk::{BytesN, Env, Vec};
use stellar_contract_utils::crypto::{
    hashable::commutative_hash_pair, hasher::Hasher, merkle::Verifier, sha256::Sha256,
};

use crate::payload::TipReceipt;

/// Leaf hash of a receipt.
pub fn receipt_leaf(e: &Env, receipt: &TipReceipt) -> BytesN<32> {
    let inner = e.crypto().sha256(&receipt.to_bytes(e));
    e.crypto().sha256(&inner.into()).to_bytes()
}

fn node(e: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    commutative_hash_pair(a, b, Sha256::new(e))
}

fn next_level(e: &Env, level: &Vec<BytesN<32>>) -> Vec<BytesN<32>> {
    let mut out = Vec::new(e);
    let mut i = 0;
    while i < level.len() {
        let a = level.get_unchecked(i);
        if i + 1 < level.len() {
            out.push_back(node(e, &a, &level.get_unchecked(i + 1)));
        } else {
            out.push_back(a);
        }
        i += 2;
    }
    out
}

/// Merkle root of `leaves` (in `seq` order). `None` when `leaves` is empty.
pub fn merkle_root(e: &Env, leaves: &Vec<BytesN<32>>) -> Option<BytesN<32>> {
    if leaves.is_empty() {
        return None;
    }
    let mut level = leaves.clone();
    while level.len() > 1 {
        level = next_level(e, &level);
    }
    level.first()
}

/// Proof for the leaf at `index`: sibling hashes from the leaf up to the root.
/// A carried node adds no sibling. `None` when `index` is out of range.
pub fn merkle_proof(e: &Env, leaves: &Vec<BytesN<32>>, index: u32) -> Option<Vec<BytesN<32>>> {
    if index >= leaves.len() {
        return None;
    }
    let mut proof = Vec::new(e);
    let mut level = leaves.clone();
    let mut i = index;
    while level.len() > 1 {
        let sibling = i ^ 1;
        if sibling < level.len() {
            proof.push_back(level.get_unchecked(sibling));
        }
        level = next_level(e, &level);
        i /= 2;
    }
    Some(proof)
}

/// Verifies that `receipt` is anchored by `root` with `proof`.
pub fn verify_receipt(
    e: &Env,
    receipt: &TipReceipt,
    proof: Vec<BytesN<32>>,
    root: BytesN<32>,
) -> bool {
    Verifier::<Sha256>::verify(e, proof, root, receipt_leaf(e, receipt))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(e: &Env, n: u8) -> BytesN<32> {
        e.crypto()
            .sha256(&soroban_sdk::Bytes::from_array(e, &[n]))
            .to_bytes()
    }

    #[test]
    fn empty_and_single() {
        let e = Env::default();
        assert_eq!(merkle_root(&e, &Vec::new(&e)), None);
        let one = soroban_sdk::vec![&e, leaf(&e, 1)];
        assert_eq!(merkle_root(&e, &one), Some(leaf(&e, 1)));
        assert_eq!(merkle_proof(&e, &one, 0).unwrap().len(), 0);
        assert_eq!(merkle_proof(&e, &one, 1), None);
    }

    #[test]
    fn every_proof_verifies_with_openzeppelin() {
        let e = Env::default();
        for n in 1u8..=9 {
            let mut leaves = Vec::new(&e);
            for i in 0..n {
                leaves.push_back(leaf(&e, i));
            }
            let root = merkle_root(&e, &leaves).unwrap();
            for i in 0..leaves.len() {
                let proof = merkle_proof(&e, &leaves, i).unwrap();
                assert!(Verifier::<Sha256>::verify(
                    &e,
                    proof.clone(),
                    root.clone(),
                    leaves.get_unchecked(i)
                ));
                assert!(!Verifier::<Sha256>::verify(
                    &e,
                    proof,
                    root.clone(),
                    leaf(&e, 200)
                ));
            }
        }
    }
}
