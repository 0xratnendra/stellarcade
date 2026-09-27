//! Stellarcade Token Vesting Arcade Contract (experimental)
//!
//! Linear-with-cliff vesting for esports team prize grants and contributor
//! reward schedules. A schedule vests `total_amount` linearly from `start`
//! over `duration` seconds, but nothing is claimable before `start + cliff`
//! elapses; at the cliff, all vesting accrued up to that point unlocks at
//! once. An optional revocable schedule lets the admin claw back whatever
//! is still unvested at the time of revocation — already-vested (but
//! unclaimed) tokens remain claimable by the beneficiary afterward.
//!
//! Like `coinflip-streak`/`lottery-syndicate` elsewhere in this experimental
//! workspace, amounts are tracked as plain `u128` ledger values rather than
//! moved via `token::Client` — this contract's interface takes no token
//! address, so `claim`/`revoke` return the amount owed rather than
//! transferring it.

#![no_std]

mod storage;
pub mod types;

use soroban_sdk::{contract, contractimpl, Address, Env};
use types::{VestingSchedule, VestingSummary};

#[contract]
pub struct TokenVestingArcadeContract;

impl TokenVestingArcadeContract {
    /// Total amount vested (unlocked, whether claimed or not) as of `now`.
    fn vested_amount(schedule: &VestingSchedule, now: u64) -> u128 {
        if schedule.revoked {
            // `revoke` already froze `total_amount` at whatever had vested
            // by then, so that value itself is the final vested amount.
            return schedule.total_amount;
        }
        Self::vested_at(schedule, now)
    }

    fn vested_at(schedule: &VestingSchedule, now: u64) -> u128 {
        let cliff_ts = schedule.start.saturating_add(schedule.cliff);
        if now < cliff_ts {
            return 0;
        }
        let end_ts = schedule.start.saturating_add(schedule.duration);
        if now >= end_ts {
            return schedule.total_amount;
        }
        let elapsed = now.saturating_sub(schedule.start) as u128;
        let duration = schedule.duration.max(1) as u128;
        // total_amount is a token-unit count well within u128 headroom for
        // this multiplication; no overflow risk at realistic scales.
        (schedule.total_amount * elapsed) / duration
    }
}

#[contractimpl]
impl TokenVestingArcadeContract {
    /// Creates a new vesting schedule. Returns the new schedule id.
    pub fn create_schedule(
        env: Env,
        admin: Address,
        beneficiary: Address,
        total_amount: u128,
        start: u64,
        cliff: u64,
        duration: u64,
        revocable: bool,
    ) -> u64 {
        admin.require_auth();

        if total_amount == 0 {
            panic!("total_amount must be greater than 0");
        }
        if duration == 0 {
            panic!("duration must be greater than 0");
        }
        if cliff > duration {
            panic!("cliff cannot exceed duration");
        }

        let schedule_id = storage::get_next_schedule_id(&env);
        storage::set_next_schedule_id(&env, schedule_id + 1);

        let schedule = VestingSchedule {
            schedule_id,
            admin,
            beneficiary,
            total_amount,
            claimed_amount: 0,
            start,
            cliff,
            duration,
            revocable,
            revoked: false,
        };
        storage::set_schedule(&env, &schedule);
        schedule_id
    }

    /// Claims all currently-unlocked, unclaimed tokens for `beneficiary`'s
    /// schedule. Returns the amount claimed (0 if none is newly claimable,
    /// e.g. before the cliff).
    pub fn claim(env: Env, schedule_id: u64, beneficiary: Address) -> u128 {
        beneficiary.require_auth();

        let mut schedule = storage::get_schedule(&env, schedule_id).expect("schedule not found");
        if schedule.beneficiary != beneficiary {
            panic!("schedule does not belong to this beneficiary");
        }

        let now = env.ledger().timestamp();
        let vested = Self::vested_amount(&schedule, now);
        if vested <= schedule.claimed_amount {
            return 0;
        }
        let payout = vested - schedule.claimed_amount;
        schedule.claimed_amount = vested;
        storage::set_schedule(&env, &schedule);
        payout
    }

    /// Revokes a revocable schedule: freezes vesting at its currently-vested
    /// amount and returns the still-unvested remainder to the admin.
    pub fn revoke(env: Env, admin: Address, schedule_id: u64) -> u128 {
        admin.require_auth();

        let mut schedule = storage::get_schedule(&env, schedule_id).expect("schedule not found");
        if schedule.admin != admin {
            panic!("only the schedule admin can revoke it");
        }
        if !schedule.revocable {
            panic!("schedule is not revocable");
        }
        if schedule.revoked {
            panic!("schedule already revoked");
        }

        let now = env.ledger().timestamp();
        let vested_now = Self::vested_at(&schedule, now);
        let clawback = schedule.total_amount - vested_now;

        schedule.total_amount = vested_now;
        schedule.revoked = true;
        storage::set_schedule(&env, &schedule);

        clawback
    }

    /// Read-only snapshot: total, vested, claimed, and locked amounts.
    pub fn get_schedule_status(env: Env, schedule_id: u64) -> VestingSummary {
        let schedule = storage::get_schedule(&env, schedule_id).expect("schedule not found");
        let now = env.ledger().timestamp();
        let vested = Self::vested_amount(&schedule, now);
        VestingSummary {
            schedule_id: schedule.schedule_id,
            beneficiary: schedule.beneficiary,
            total_amount: schedule.total_amount,
            vested_amount: vested,
            claimed_amount: schedule.claimed_amount,
            locked_amount: schedule.total_amount.saturating_sub(vested),
            revoked: schedule.revoked,
        }
    }
}

#[cfg(test)]
mod test;
