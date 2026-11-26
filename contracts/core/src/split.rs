//! Split rules and the per-tip split (`02-core-contract.md`, section 2.1;
//! `01-architecture.md`, section 1.5).

use quilltip_shared::{fee, BPS_DENOMINATOR};
use soroban_sdk::{panic_with_error, Address, Env, Vec};

use crate::errors::CoreError;
use crate::storage::{Split, MAX_RECIPIENTS};

/// Enforces the split rules (I-8). Empty splits are valid.
///
/// 1. More than `MAX_RECIPIENTS` entries: `TooManyRecipients`.
/// 2. One entry, `splits[0].recipient != author`, a zero or oversized `bps`,
///    `Σ bps != 10_000`, a repeated recipient, or the treasury as a recipient:
///    `InvalidSplits`.
pub fn validate(e: &Env, author: &Address, treasury: &Address, splits: &Vec<Split>) {
    let len = splits.len();
    if len == 0 {
        return;
    }
    if len > MAX_RECIPIENTS {
        panic_with_error!(e, CoreError::TooManyRecipients);
    }
    if len < 2 || splits.get_unchecked(0).recipient != *author {
        panic_with_error!(e, CoreError::InvalidSplits);
    }
    let mut sum: u32 = 0;
    for i in 0..len {
        let s = splits.get_unchecked(i);
        if s.bps == 0 || s.bps > BPS_DENOMINATOR || s.recipient == *treasury {
            panic_with_error!(e, CoreError::InvalidSplits);
        }
        for j in 0..i {
            if splits.get_unchecked(j).recipient == s.recipient {
                panic_with_error!(e, CoreError::InvalidSplits);
            }
        }
        sum += s.bps; // at most 5 × 10_000, no overflow
    }
    if sum != BPS_DENOMINATOR {
        panic_with_error!(e, CoreError::InvalidSplits);
    }
}

/// Returns `true` when `who` is the author or any split recipient.
pub fn is_recipient(author: &Address, splits: &Vec<Split>, who: &Address) -> bool {
    if author == who {
        return true;
    }
    splits.iter().any(|s| s.recipient == *who)
}

/// Number of recipients a tip pays (1 without splits).
pub fn recipient_count(splits: &Vec<Split>) -> u32 {
    if splits.is_empty() {
        1
    } else {
        splits.len()
    }
}

/// `(fee, net, shares)` for `gross`, one share per recipient in recipient
/// order. The first recipient receives `net - Σ others` (I-1, I-2).
pub fn compute(
    e: &Env,
    author: &Address,
    splits: &Vec<Split>,
    gross: i128,
) -> (i128, i128, Vec<(Address, i128)>) {
    let (fee, net) =
        fee::fee_and_net(gross).unwrap_or_else(|| panic_with_error!(e, CoreError::Overflow));
    let mut shares: Vec<(Address, i128)> = Vec::new(e);
    if splits.is_empty() {
        shares.push_back((author.clone(), net));
        return (fee, net, shares);
    }
    let mut others: i128 = 0;
    let mut rest: Vec<(Address, i128)> = Vec::new(e);
    for i in 1..splits.len() {
        let s = splits.get_unchecked(i);
        let share =
            fee::share(net, s.bps).unwrap_or_else(|| panic_with_error!(e, CoreError::Overflow));
        others = others
            .checked_add(share)
            .unwrap_or_else(|| panic_with_error!(e, CoreError::Overflow));
        rest.push_back((s.recipient, share));
    }
    let primary = net
        .checked_sub(others)
        .unwrap_or_else(|| panic_with_error!(e, CoreError::Overflow));
    shares.push_back((splits.get_unchecked(0).recipient, primary));
    shares.append(&rest);
    (fee, net, shares)
}
