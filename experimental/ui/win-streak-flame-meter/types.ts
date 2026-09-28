export type StreakFlameLevel = 'normal' | 'hot' | 'blue' | 'purple';
export interface WinStreakFlameMeterProps { currentStreak: number; maxStreak: number; milestones: number[]; onMilestoneReached?: (milestone: number) => void; }
