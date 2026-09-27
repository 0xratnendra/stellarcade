export interface LiveChatReactionBarProps {
  onSendReaction: (emoji: string) => void;
  onPlaySoundCue?: (cue: "reaction_sent" | "cooldown_blocked") => void;
  cooldownMs?: number;
  disabled?: boolean;
  isSpectatorOnly?: boolean;
  className?: string;
  presetEmojis?: string[];
}

export interface FloatingBurst {
  id: string;
  emoji: string;
  xOffset: number;
}
