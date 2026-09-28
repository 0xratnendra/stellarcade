export type AssetKind = 'image' | 'audio' | 'vector';

export interface AssetRecord {
  path: string;
  kind: AssetKind;
  extension: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  isCompressed: boolean;
}

export interface AuditFlag {
  message: string;
  filePath?: string;
  severity: 'warning' | 'info';
}

export interface AuditOptions {
  dir: string;
  maxImageKb: number;
  maxAudioKb: number;
}

export interface AuditSummary {
  totalBytes: number;
  assets: AssetRecord[];
  flags: AuditFlag[];
  table: string;
}
