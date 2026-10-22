#![no_std]

//! # Reward Vesting Contract
//!
//! Deterministic vesting of game rewards over a configurable cliff + linear
//! schedule. Rewards may be revoked by the admin before full vesting.

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, Env, Map, Vec,
};

// ─── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    pub schedule_id: u64,
    pub user: Address,
    pub amount: i128,
    pub start_timestamp: u64,
    pub cliff_seconds: u64,
    pub duration_seconds: u64,
    pub claimed: i128,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSummary {
    pub total_allocation: i128,
    pub claimed_amount: i128,
    pub claimable_amount: i128,
    pub remaining_amount: i128,
    pub current_timestamp: u64,
    pub is_fully_vested: bool,
    pub has_active_schedules: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    NextScheduleId,
    ScheduleMap,
    UserSchedules(Address),
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct VestingInitialized {
    pub admin: Address,
    pub token_address: Address,
}

#[contractevent]
pub struct VestingScheduled {
    pub user: Address,
    pub schedule_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct VestingClaimed {
    pub user: Address,
    pub total_claim: i128,
}

#[contractevent]
pub struct VestingRevoked {
    pub schedule_id: u64,
    pub user: Address,
    pub unvested: i128,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct RewardVestingContract;

#[contractimpl]
impl RewardVestingContract {
    /// Initialise the vesting contract. Must be called once.
    pub fn init(env: Env, admin: Address, token_address: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Token, &token_address);
        env.storage()
            .instance()
            .set(&DataKey::NextScheduleId, &0u64);
        let empty: Map<u64, VestingSchedule> = Map::new(&env);
        env.storage().instance().set(&DataKey::ScheduleMap, &empty);
        VestingInitialized {
            admin,
            token_address,
        }
        .publish(&env);
    }

    /// Create a new vesting schedule for `user`.
    ///
    /// * `amount`             – tokens to vest (> 0)
    /// * `start_timestamp`    – when vesting begins (UNIX seconds)
    /// * `cliff_seconds`      – seconds from start before any claim
    /// * `duration_seconds`   – total linear-vesting window (> 0)
    pub fn create_vesting_schedule(
        env: Env,
        user: Address,
        amount: i128,
        start_timestamp: u64,
        cliff_seconds: u64,
        duration_seconds: u64,
    ) -> u64 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        if amount <= 0 {
            panic!("Invalid amount: must be positive");
        }
        if duration_seconds == 0 {
            panic!("Invalid duration: must be positive");
        }

        // Transfer tokens from admin into the contract.
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token = token::Client::new(&env, &token_addr);
        let contract_addr = env.current_contract_address();
        token.transfer(&admin, &contract_addr, &amount);

        let schedule_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextScheduleId)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::NextScheduleId, &(schedule_id + 1));

        let schedule = VestingSchedule {
            schedule_id,
            user: user.clone(),
            amount,
            start_timestamp,
            cliff_seconds,
            duration_seconds,
            claimed: 0,
            revoked: false,
        };

        let mut map: Map<u64, VestingSchedule> = env
            .storage()
            .instance()
            .get(&DataKey::ScheduleMap)
            .unwrap_or(Map::new(&env));
        map.set(schedule_id, schedule);
        env.storage().instance().set(&DataKey::ScheduleMap, &map);

        // Track by user.
        let user_key = DataKey::UserSchedules(user.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&user_key)
            .unwrap_or(Vec::new(&env));
        ids.push_back(schedule_id);
        env.storage().persistent().set(&user_key, &ids);

        VestingScheduled {
            user,
            schedule_id,
            amount,
        }
        .publish(&env);
        schedule_id
    }

    /// Claim all currently vested tokens for `user`. Returns amount transferred.
    pub fn claim_vested(env: Env, user: Address) -> i128 {
        user.require_auth();

        let user_key = DataKey::UserSchedules(user.clone());
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&user_key)
            .unwrap_or(Vec::new(&env));

        let mut map: Map<u64, VestingSchedule> = env
            .storage()
            .instance()
            .get(&DataKey::ScheduleMap)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token = token::Client::new(&env, &token_addr);

        let mut total_claim: i128 = 0;

        for id in ids.iter() {
            let mut schedule = match map.get(id) {
                Some(s) => s,
                None => continue,
            };
            if schedule.revoked {
                continue;
            }
            let vested = Self::vested_amount(&schedule, now);
            let claimable = vested.saturating_sub(schedule.claimed).max(0);
            if claimable <= 0 {
                continue;
            }
            schedule.claimed += claimable;
            map.set(id, schedule);
            total_claim += claimable;
        }

        if total_claim == 0 {
            panic!("Nothing to claim");
        }

        env.storage().instance().set(&DataKey::ScheduleMap, &map);
        token.transfer(&env.current_contract_address(), &user, &total_claim);
        VestingClaimed { user, total_claim }.publish(&env);
        total_claim
    }

    /// Revoke a vesting schedule. Unvested tokens are returned to the admin.
    pub fn revoke_schedule(env: Env, schedule_id: u64) -> i128 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        let mut map: Map<u64, VestingSchedule> = env
            .storage()
            .instance()
            .get(&DataKey::ScheduleMap)
            .unwrap_or(Map::new(&env));

        let mut schedule = map.get(schedule_id).expect("Schedule not found");
        if schedule.revoked {
            panic!("Schedule already revoked");
        }

        let now = env.ledger().timestamp();
        let vested = Self::vested_amount(&schedule, now);
        let unvested = schedule.amount.saturating_sub(vested).max(0);

        schedule.revoked = true;
        let user = schedule.user.clone();
        map.set(schedule_id, schedule);
        env.storage().instance().set(&DataKey::ScheduleMap, &map);

        if unvested > 0 {
            let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
            let token = token::Client::new(&env, &token_addr);
            token.transfer(&env.current_contract_address(), &admin, &unvested);
        }

        VestingRevoked {
            schedule_id,
            user,
            unvested,
        }
        .publish(&env);
        unvested
    }

    /// Return all vesting schedules for `user`.
    pub fn vesting_state(env: Env, user: Address) -> Vec<VestingSchedule> {
        let user_key = DataKey::UserSchedules(user.clone());
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&user_key)
            .unwrap_or(Vec::new(&env));

        let map: Map<u64, VestingSchedule> = env
            .storage()
            .instance()
            .get(&DataKey::ScheduleMap)
            .unwrap_or(Map::new(&env));

        let mut result = Vec::new(&env);
        for id in ids.iter() {
            if let Some(s) = map.get(id) {
                result.push_back(s);
            }
        }
        result
    }

    /// Return a vesting summary for `user` with allocation, claimed, claimable, and remaining amounts.
    /// Returns empty summary with zero values if user has no vesting schedules.
    pub fn get_vesting_summary(env: Env, user: Address) -> VestingSummary {
        let user_key = DataKey::UserSchedules(user.clone());
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&user_key)
            .unwrap_or(Vec::new(&env));

        let map: Map<u64, VestingSchedule> = env
            .storage()
            .instance()
            .get(&DataKey::ScheduleMap)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        let mut total_allocation = 0i128;
        let mut claimed_amount = 0i128;
        let mut claimable_amount = 0i128;
        let mut has_active_schedules = false;

        for id in ids.iter() {
            if let Some(schedule) = map.get(id) {
                if !schedule.revoked {
                    total_allocation += schedule.amount;
                    claimed_amount += schedule.claimed;

                    let vested = Self::vested_amount(&schedule, now);
                    let schedule_claimable = vested.saturating_sub(schedule.claimed).max(0);
                    claimable_amount += schedule_claimable;

                    // Check if schedule is still active (not fully vested)
                    if vested < schedule.amount {
                        has_active_schedules = true;
                    }
                }
            }
        }

        let remaining_amount = total_allocation.saturating_sub(claimed_amount);
        let is_fully_vested = !has_active_schedules && total_allocation > 0;

        VestingSummary {
            total_allocation,
            claimed_amount,
            claimable_amount,
            remaining_amount,
            current_timestamp: now,
            is_fully_vested,
            has_active_schedules,
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fn vested_amount(schedule: &VestingSchedule, now: u64) -> i128 {
        if now < schedule.start_timestamp + schedule.cliff_seconds {
            return 0;
        }
        let elapsed = now.saturating_sub(schedule.start_timestamp);
        if elapsed >= schedule.duration_seconds {
            return schedule.amount;
        }
        (schedule.amount as u128)
            .saturating_mul(elapsed as u128)
            .saturating_div(schedule.duration_seconds as u128) as i128
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Env,
    };

    fn setup_token(env: &Env, admin: &Address) -> (token::Client<'static>, Address) {
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_addr = token_contract.address();
        let token_client = token::Client::new(env, &token_addr);
        let sac = token::StellarAssetClient::new(env, &token_addr);
        sac.mint(admin, &1_000_000);
        (token_client, token_addr)
    }

    fn setup() -> (
        Env,
        RewardVestingContractClient<'static>,
        Address,
        token::Client<'static>,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let (token_client, token_addr) = setup_token(&env, &admin);
        let contract_id = env.register(RewardVestingContract, ());
        let client = RewardVestingContractClient::new(&env, &contract_id);
        client.init(&admin, &token_addr);
        (env, client, admin, token_client)
    }

    #[test]
    fn test_init() {
        let _ = setup();
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_init_fails() {
        let (env, client, admin, _tc) = setup();
        let token_addr = Address::generate(&env);
        client.init(&admin, &token_addr);
    }

    #[test]
    fn test_create_schedule() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        let id = client.create_vesting_schedule(&user, &10_000, &now, &0, &1000);
        assert_eq!(id, 0);
    }

    #[test]
    #[should_panic(expected = "Invalid amount")]
    fn test_invalid_amount_rejected() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        client.create_vesting_schedule(&user, &0, &now, &0, &1000);
    }

    #[test]
    #[should_panic(expected = "Invalid duration")]
    fn test_zero_duration_rejected() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        client.create_vesting_schedule(&user, &100, &now, &0, &0);
    }

    #[test]
    #[should_panic(expected = "Nothing to claim")]
    fn test_cliff_blocks_claim() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        client.create_vesting_schedule(&user, &10_000, &now, &3600, &7200);
        client.claim_vested(&user);
    }

    #[test]
    fn test_claim_after_full_vest() {
        let (env, client, _admin, token_client) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount = 50_000i128;
        client.create_vesting_schedule(&user, &amount, &start, &0, &1000);
        env.ledger().with_mut(|l| l.timestamp = start + 2000);
        let claimed = client.claim_vested(&user);
        assert_eq!(claimed, amount);
        assert_eq!(token_client.balance(&user), amount);
    }

    #[test]
    fn test_partial_claim() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount = 10_000i128;
        client.create_vesting_schedule(&user, &amount, &start, &0, &1000);
        env.ledger().with_mut(|l| l.timestamp = start + 500);
        let claimed = client.claim_vested(&user);
        assert_eq!(claimed, 5_000);
    }

    #[test]
    fn test_revoke_schedule() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount = 20_000i128;
        let id = client.create_vesting_schedule(&user, &amount, &start, &0, &1000);
        let unvested = client.revoke_schedule(&id);
        assert_eq!(unvested, amount);
    }

    #[test]
    #[should_panic(expected = "Schedule already revoked")]
    fn test_revoke_twice_fails() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        let id = client.create_vesting_schedule(&user, &1000, &now, &0, &500);
        client.revoke_schedule(&id);
        client.revoke_schedule(&id);
    }

    #[test]
    fn test_vesting_state_returns_schedules() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        client.create_vesting_schedule(&user, &500, &now, &0, &100);
        client.create_vesting_schedule(&user, &700, &now, &50, &200);
        let state = client.vesting_state(&user);
        assert_eq!(state.len(), 2);
    }

    #[test]
    fn test_ids_increment() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        let id0 = client.create_vesting_schedule(&user, &100, &now, &0, &10);
        let id1 = client.create_vesting_schedule(&user, &200, &now, &0, &10);
        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
    }

    #[test]
    fn test_vesting_summary_empty_user() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let summary = client.get_vesting_summary(&user);

        assert_eq!(summary.total_allocation, 0);
        assert_eq!(summary.claimed_amount, 0);
        assert_eq!(summary.claimable_amount, 0);
        assert_eq!(summary.remaining_amount, 0);
        assert!(!summary.is_fully_vested);
        assert!(!summary.has_active_schedules);
    }

    #[test]
    fn test_vesting_summary_pre_vesting() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let now = env.ledger().timestamp();
        let amount = 10_000i128;

        client.create_vesting_schedule(&user, &amount, &now, &3600, &7200);
        let summary = client.get_vesting_summary(&user);

        assert_eq!(summary.total_allocation, amount);
        assert_eq!(summary.claimed_amount, 0);
        assert_eq!(summary.claimable_amount, 0);
        assert_eq!(summary.remaining_amount, amount);
        assert!(!summary.is_fully_vested);
        assert!(summary.has_active_schedules);
    }

    #[test]
    fn test_vesting_summary_mid_vesting() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount = 10_000i128;

        client.create_vesting_schedule(&user, &amount, &start, &0, &1000);
        env.ledger().with_mut(|l| l.timestamp = start + 500);

        let summary = client.get_vesting_summary(&user);

        assert_eq!(summary.total_allocation, amount);
        assert_eq!(summary.claimed_amount, 0);
        assert_eq!(summary.claimable_amount, 5_000);
        assert_eq!(summary.remaining_amount, amount);
        assert!(!summary.is_fully_vested);
        assert!(summary.has_active_schedules);
    }

    #[test]
    fn test_vesting_summary_fully_vested() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount = 10_000i128;

        client.create_vesting_schedule(&user, &amount, &start, &0, &1000);
        env.ledger().with_mut(|l| l.timestamp = start + 2000);

        let summary = client.get_vesting_summary(&user);

        assert_eq!(summary.total_allocation, amount);
        assert_eq!(summary.claimed_amount, 0);
        assert_eq!(summary.claimable_amount, amount);
        assert_eq!(summary.remaining_amount, amount);
        assert!(summary.is_fully_vested);
        assert!(!summary.has_active_schedules);
    }

    #[test]
    fn test_vesting_summary_partial_claim() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount = 10_000i128;

        client.create_vesting_schedule(&user, &amount, &start, &0, &1000);
        env.ledger().with_mut(|l| l.timestamp = start + 500);

        let claimed = client.claim_vested(&user);
        assert_eq!(claimed, 5_000);

        let summary = client.get_vesting_summary(&user);

        assert_eq!(summary.total_allocation, amount);
        assert_eq!(summary.claimed_amount, 5_000);
        assert_eq!(summary.claimable_amount, 0);
        assert_eq!(summary.remaining_amount, 5_000);
        assert!(!summary.is_fully_vested);
        assert!(summary.has_active_schedules);
    }

    #[test]
    fn test_vesting_summary_revoked_schedule() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount = 10_000i128;

        let id = client.create_vesting_schedule(&user, &amount, &start, &0, &1000);
        client.revoke_schedule(&id);

        let summary = client.get_vesting_summary(&user);

        assert_eq!(summary.total_allocation, 0);
        assert_eq!(summary.claimed_amount, 0);
        assert_eq!(summary.claimable_amount, 0);
        assert_eq!(summary.remaining_amount, 0);
        assert!(!summary.is_fully_vested);
        assert!(!summary.has_active_schedules);
    }

    #[test]
    fn test_vesting_summary_multiple_schedules() {
        let (env, client, _admin, _tc) = setup();
        let user = Address::generate(&env);
        let start = env.ledger().timestamp();
        let amount1 = 5_000i128;
        let amount2 = 10_000i128;

        client.create_vesting_schedule(&user, &amount1, &start, &0, &1000);
        client.create_vesting_schedule(&user, &amount2, &start, &3600, &7200);
        env.ledger().with_mut(|l| l.timestamp = start + 500);

        let summary = client.get_vesting_summary(&user);

        assert_eq!(summary.total_allocation, amount1 + amount2);
        assert_eq!(summary.claimed_amount, 0);
        assert_eq!(summary.claimable_amount, 2_500); // Only first schedule has vested
        assert_eq!(summary.remaining_amount, amount1 + amount2);
        assert!(!summary.is_fully_vested);
        assert!(summary.has_active_schedules);
    }
}
