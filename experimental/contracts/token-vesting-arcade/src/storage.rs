use soroban_sdk::Env;

use crate::types::VestingSchedule;

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum DataKey {
    NextScheduleId,
    Schedule(u64),
}

pub fn get_next_schedule_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextScheduleId)
        .unwrap_or(1u64)
}

pub fn set_next_schedule_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextScheduleId, &id);
}

pub fn get_schedule(env: &Env, schedule_id: u64) -> Option<VestingSchedule> {
    env.storage().instance().get(&DataKey::Schedule(schedule_id))
}

pub fn set_schedule(env: &Env, schedule: &VestingSchedule) {
    env.storage()
        .instance()
        .set(&DataKey::Schedule(schedule.schedule_id), schedule);
}
