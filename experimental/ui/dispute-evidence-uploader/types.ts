export type DisputeReason = 'Oracle Desync' | 'Timeout Glitch' | 'Invalid Salt';

export const DISPUTE_REASONS: DisputeReason[] = ['Oracle Desync', 'Timeout Glitch', 'Invalid Salt'];

export interface DisputeEvidence {
  matchId: string;
  transactionHash: string;
  reason: DisputeReason;
  notes: string;
}

export interface DisputeEvidenceUploaderProps {
  isOpen: boolean;
  matchId: string;
  onSubmit: (evidence: DisputeEvidence) => Promise<void>;
  onClose: () => void;
}
