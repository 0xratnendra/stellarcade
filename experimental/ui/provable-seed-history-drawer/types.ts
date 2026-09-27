export interface SeedHistoryEntry {
  id: string;
  clientSeed: string;
  serverSeedHash: string;
  unrevealedServerSeed?: string;
  nonceCount: number;
  createdAt: string;
  status: "active" | "rotated" | "verified";
  explorerUrl?: string;
}

export interface ProvableSeedHistoryDrawerProps {
  isOpen: boolean;
  seeds: SeedHistoryEntry[];
  onRotateSeed: () => Promise<void> | void;
  onClose: () => void;
  className?: string;
}
