export type ChestTier = 'bronze' | 'silver' | 'gold' | 'diamond';

export type LootTier = 'Common' | 'Rare' | 'Epic' | 'Legendary';

export interface StreakChestReward {
  id: string;
  name: string;
  tier: string;
  amount: number;
  symbol: string;
}

export type AnimationPhase = 'idle' | 'shaking' | 'opened' | 'revealed';

export interface StreakChestUnboxingProps {
  isOpen: boolean;
  chestTier: ChestTier;
  reward: StreakChestReward | null;
  onClaim: (rewardId: string) => Promise<void> | void;
  onClose: () => void;
}
