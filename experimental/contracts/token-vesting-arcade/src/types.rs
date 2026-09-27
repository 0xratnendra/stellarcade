use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    pub schedule_id: u64,
    pub admin: Address,
    pub beneficiary: Address,
    pub total_amount: u128,
    pub claimed_amount: u128,
    pub start: u64,
    pub cliff: u64,
    pub duration: u64,
    pub revocable: bool,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSummary {
    pub schedule_id: u64,
    pub beneficiary: Address,
    pub total_amount: u128,
    pub vested_amount: u128,
    pub claimed_amount: u128,
    pub locked_amount: u128,
    pub revoked: bool,
}
