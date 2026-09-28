export type StorageType = 'instance' | 'persistent' | 'temporary';

export interface StorageEstimateInput {
  bytes: number;
  type: StorageType;
  ledgers: number;
  feePerKb?: number;
}

export interface RentEstimate {
  bytes: number;
  type: StorageType;
  feePerKb: number;
  perLedger: number;
  totalRent: number;
}

export interface ComparisonRow {
  type: StorageType;
  bytes: number;
  feePerKb: number;
  estimatedRent: number;
}
