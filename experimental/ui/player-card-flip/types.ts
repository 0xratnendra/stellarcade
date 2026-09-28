export interface PlayerBadge { id: string; name: string; icon?: string; }
export interface PlayerProfile { avatarUrl?: string; gamertag: string; rank: string; winRate: number; badges: PlayerBadge[]; totalWagered: string; joinDate: string; }
export interface PlayerCardFlipProps { player: PlayerProfile; isHolographic?: boolean; defaultFlipped?: boolean; className?: string; }
