export interface PayoutProjection {
  wagerAmount: number;
  multiplier: number;
  houseEdgePct: number;
  grossPayout: number;
  feeAmount: number;
  netPayout: number;
  netProfit: number;
}

export interface PayoutCalculatorSliderProps {
  initialWager?: number;
  houseEdgePct?: number;
  maxWager?: number;
  minWager?: number;
  userBalance?: number;
  onWagerChange?: (payout: PayoutProjection) => void;
  className?: string;
}
