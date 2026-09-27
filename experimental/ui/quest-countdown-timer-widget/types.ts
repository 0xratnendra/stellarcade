export interface QuestCountdownTimerWidgetProps {
  /** ISO timestamp string, or epoch milliseconds, of when the countdown
   * target (quest reset / epoch end) occurs. */
  targetResetTimestamp: string | number;
  onExpire?: () => void;
  label?: string;
  className?: string;
}

export interface RemainingTime {
  totalMs: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}
