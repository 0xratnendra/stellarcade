import * as fs from 'node:fs';
import * as path from 'node:path';
import { AuditFlag, AuditOptions, AuditSummary, AssetRecord } from './types';

const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg']);
const VECTOR_EXTENSIONS = new Set(['.svg']);

export const defaultAuditOptions: AuditOptions = {
  dir: process.cwd(),
  maxImageKb: 500,
  maxAudioKb: 1000,
};

const readHeader = (filePath: string, length: number): Buffer => {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(length);
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return bytesRead === 0 ? Buffer.alloc(0) : buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
};

const parsePngDimensions = (buffer: Buffer): { width?: number; height?: number } => {
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
    return {};
  }

  const width = buffer.readUInt32BE(8);
  const height = buffer.readUInt32BE(12);
  return { width, height };
};

const parseWebpDimensions = (buffer: Buffer): { width?: number; height?: number } => {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return {};
  }

  const width = buffer.readUIntLE(26, 2);
  const height = buffer.readUIntLE(28, 2);
  return { width, height };
};

const parseSvgDimensions = (filePath: string): { width?: number; height?: number } => {
  try {
    const content = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
    const widthMatch = content.match(/width=["']?(\d+(?:\.\d+)?)px?/i);
    const heightMatch = content.match(/height=["']?(\d+(?:\.\d+)?)px?/i);

    return {
      width: widthMatch ? Number.parseFloat(widthMatch[1]) : undefined,
      height: heightMatch ? Number.parseFloat(heightMatch[1]) : undefined,
    };
  } catch {
    return {};
  }
};

const walkDirectory = (rootDir: string): string[] => {
  const files: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const describeRecord = (filePath: string): AssetRecord => {
  const ext = path.extname(filePath).toLowerCase();
  const sizeBytes = fs.statSync(filePath).size;

  if (IMAGE_EXTENSIONS.has(ext)) {
    const { width, height } = ext === '.png' ? parsePngDimensions(readHeader(filePath, 24)) : ext === '.webp' ? parseWebpDimensions(readHeader(filePath, 30)) : {};
    return {
      path: filePath,
      kind: 'image',
      extension: ext,
      sizeBytes,
      width,
      height,
      isCompressed: ext !== '.png',
    };
  }

  if (AUDIO_EXTENSIONS.has(ext)) {
    return {
      path: filePath,
      kind: 'audio',
      extension: ext,
      sizeBytes,
      isCompressed: ext !== '.wav',
    };
  }

  if (VECTOR_EXTENSIONS.has(ext)) {
    const dimensions = parseSvgDimensions(filePath);
    return {
      path: filePath,
      kind: 'vector',
      extension: ext,
      sizeBytes,
      width: dimensions.width,
      height: dimensions.height,
      isCompressed: true,
    };
  }

  return {
    path: filePath,
    kind: 'vector',
    extension: ext,
    sizeBytes,
    isCompressed: false,
  };
};

export const formatBytes = (sizeBytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export const renderAssetSummary = (summary: AuditSummary): string => {
  return summary.table;
};

export const auditAssetDirectory = (options: Partial<AuditOptions> = {}): AuditSummary => {
  const auditOptions: AuditOptions = {
    dir: options.dir ?? defaultAuditOptions.dir,
    maxImageKb: options.maxImageKb ?? defaultAuditOptions.maxImageKb,
    maxAudioKb: options.maxAudioKb ?? defaultAuditOptions.maxAudioKb,
  };

  if (!fs.existsSync(auditOptions.dir)) {
    throw new Error(`Directory does not exist: ${auditOptions.dir}`);
  }

  const files = walkDirectory(auditOptions.dir);
  const assets = files
    .filter((file) => /\.(png|webp|mp3|wav|ogg|svg)$/i.test(file))
    .map(describeRecord);

  const flags: AuditFlag[] = [];

  const imageAssets = assets.filter((asset) => asset.kind === 'image');
  const audioAssets = assets.filter((asset) => asset.kind === 'audio');

  for (const asset of audioAssets) {
    const thresholdBytes = auditOptions.maxAudioKb * 1024;
    if (asset.extension === '.wav' && asset.sizeBytes > thresholdBytes) {
      flags.push({
        severity: 'warning',
        filePath: asset.path,
        message: `WAV audio exceeds ${auditOptions.maxAudioKb} KB and should be converted to OGG/MP3.`,
      });
    }
  }

  for (const asset of imageAssets) {
    const thresholdBytes = auditOptions.maxImageKb * 1024;
    const hasWebpCounterpart = imageAssets.some(
      (candidate) =>
        candidate.extension === '.webp' &&
        candidate.path.replace(/\.[^/.]+$/, '') === asset.path.replace(/\.[^/.]+$/, ''),
    );

    if (asset.extension === '.png' && asset.sizeBytes > thresholdBytes && !hasWebpCounterpart) {
      flags.push({
        severity: 'warning',
        filePath: asset.path,
        message: `PNG exceeds ${auditOptions.maxImageKb} KB and has no WebP alternative.`,
      });
    }
  }

  const categoryTotals = {
    images: assets.filter((asset) => asset.kind === 'image').reduce((sum, asset) => sum + asset.sizeBytes, 0),
    audio: assets.filter((asset) => asset.kind === 'audio').reduce((sum, asset) => sum + asset.sizeBytes, 0),
    vectors: assets.filter((asset) => asset.kind === 'vector').reduce((sum, asset) => sum + asset.sizeBytes, 0),
  };

  const totalBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);

  const lines = [
    'Asset bundle summary',
    'Category | Files | Total',
    '--- | ---: | ---:',
    `Images | ${imageAssets.length} | ${formatBytes(categoryTotals.images)}`,
    `Audio | ${audioAssets.length} | ${formatBytes(categoryTotals.audio)}`,
    `Vectors | ${assets.filter((asset) => asset.kind === 'vector').length} | ${formatBytes(categoryTotals.vectors)}`,
    `Total bundle size | ${assets.length} | ${formatBytes(totalBytes)}`,
  ];

  if (flags.length > 0) {
    lines.push('', 'Warnings:');
    for (const flag of flags) {
      lines.push(`- ${flag.filePath ?? 'bundle'}: ${flag.message}`);
    }
  }

  return {
    totalBytes,
    assets,
    flags,
    table: lines.join('\n'),
  };
};
