export type VipTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface VipPerk {
  id: string;
  label: string;
  /** True if the current tier has unlocked this perk. */
  unlocked: boolean;
}

export interface VipLevelProgressTrackerProps {
  currentTier: string;
  currentPoints: number;
  /**
   * Points required to reach the next tier. If this is less than or equal
   * to `currentPoints`, the player is treated as having reached the
   * maximum tier (there is no further tier to progress toward), and the
   * component renders a "Maximum Tier Reached" banner instead of a
   * progress bar.
   */
  nextTierPoints: number;
  perks: VipPerk[];
  className?: string;
}
