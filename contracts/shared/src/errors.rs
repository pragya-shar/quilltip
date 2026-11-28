//! Error-code ranges.
//!
//! A failed call reports only `Error(Contract, #N)`, so codes never overlap
//! across QuillTip contracts. Every code stays below 100, the range
//! OpenZeppelin leaves to contract-specific errors.

/// An inclusive range of `#[contracterror]` codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ErrorRange {
    pub first: u32,
    pub last: u32,
}

impl ErrorRange {
    /// Returns `true` when `code` is inside this range.
    pub const fn contains(&self, code: u32) -> bool {
        code >= self.first && code <= self.last
    }
}

/// `CoreError`: 1 to 29.
pub const CORE: ErrorRange = ErrorRange { first: 1, last: 29 };

/// `TabError`: 30 to 69.
pub const TAB: ErrorRange = ErrorRange {
    first: 30,
    last: 69,
};

/// `NftError`: 70 to 89.
pub const NFT: ErrorRange = ErrorRange {
    first: 70,
    last: 89,
};

/// Reserved for later QuillTip contracts: 90 to 99.
pub const RESERVED: ErrorRange = ErrorRange {
    first: 90,
    last: 99,
};

/// Lowest error code used by OpenZeppelin Stellar contracts 0.8.0.
pub const OPENZEPPELIN_FIRST: u32 = 100;

// The ranges are ordered, adjacent, start at 1 and stay below OpenZeppelin's codes.
const _: () = {
    assert!(CORE.first == 1 && CORE.first <= CORE.last);
    assert!(CORE.last + 1 == TAB.first && TAB.first <= TAB.last);
    assert!(TAB.last + 1 == NFT.first && NFT.first <= NFT.last);
    assert!(NFT.last + 1 == RESERVED.first && RESERVED.first <= RESERVED.last);
    assert!(RESERVED.last < OPENZEPPELIN_FIRST);
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contains_is_inclusive() {
        assert!(TAB.contains(30) && TAB.contains(69));
        assert!(!TAB.contains(29) && !TAB.contains(70));
    }
}
