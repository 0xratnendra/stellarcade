import type { ComparisonRow, RentEstimate, StorageEstimateInput, StorageType } from './types';

export const SOROBAN_RENT_FEE_PER_KB = 1_000_000;
export const STORAGE_TYPE_FACTORS: Record<StorageType, number> = {
  instance: 1.2,
  persistent: 1.0,
  temporary: 0.6,
};

export const calculateSerializedByteSize = (value: string): number => {
  if (!Number.isFinite(value.length) || value.length < 0) {
    throw new Error('Serialized value length must be a non-negative integer.');
  }
  return Buffer.byteLength(value, 'utf8');
};

export const calculateStorageRent = ({
  bytes,
  type,
  ledgers,
  feePerKb = SOROBAN_RENT_FEE_PER_KB,
}: StorageEstimateInput): RentEstimate => {
  if (bytes < 0) {
    throw new Error('Bytes must be non-negative.');
  }
  if (ledgers < 0) {
    throw new Error('Ledgers must be non-negative.');
  }

  const multiplier = STORAGE_TYPE_FACTORS[type] ?? 1;
  const kilobyteUnits = Math.max(1, Math.ceil(bytes / 1024));
  const perLedger = kilobyteUnits * feePerKb * multiplier;
  return {
    bytes,
    type,
    feePerKb,
    perLedger,
    totalRent: perLedger * ledgers,
  };
};

export const estimateTtlExtensionCost = (bytes: number, type: StorageType, ledgers: number): number =>
  calculateStorageRent({ bytes, type, ledgers }).totalRent;

export const compareStorageTypes = (bytes: number, ledgers: number): ComparisonRow[] => {
  const types: StorageType[] = ['instance', 'persistent', 'temporary'];
  return types.map((type) => {
    const estimate = calculateStorageRent({ bytes, type, ledgers });
    return {
      type,
      bytes,
      feePerKb: estimate.feePerKb,
      estimatedRent: estimate.totalRent,
    };
  });
};

export const renderComparisonTable = (rows: ComparisonRow[]): string => {
  const lines = ['Storage type | Bytes | Fee / KB | Estimated rent', '--- | ---: | ---: | ---:'];
  for (const row of rows) {
    lines.push(`${row.type} | ${row.bytes} | ${row.feePerKb} | ${row.estimatedRent}`);
  }
  return lines.join('\n');
};
