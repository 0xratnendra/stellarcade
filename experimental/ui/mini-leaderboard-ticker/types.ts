export interface TickerWinItem {
  id: string;
  playerAddress: string;
  game: string;
  gameIcon?: string;
  payout: string;
  multiplier: number | string;
  avatarUrl?: string;
}

export interface MiniLeaderboardTickerProps {
  wins: TickerWinItem[];
  speed?: number;
  onSelectWin?: (item: TickerWinItem) => void;
}
