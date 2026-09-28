import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { auditAssetDirectory } from './assetAuditor';

describe('asset auditor', () => {
  it('flags WAV files exceeding the audio threshold', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-auditor-'));
    const wavPath = path.join(tempDir, 'music.wav');
    const header = Buffer.from('RIFF', 'ascii');
    const wave = Buffer.alloc(1_500_000);
    const file = Buffer.concat([header, Buffer.from('WAVE', 'ascii'), wave]);
    fs.writeFileSync(wavPath, file);

    const summary = auditAssetDirectory({ dir: tempDir, maxImageKb: 500, maxAudioKb: 1000 });
    expect(summary.flags.some((flag) => flag.filePath?.endsWith('music.wav'))).toBe(true);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('flags PNG assets missing a WebP counterpart', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-auditor-'));
    const pngPath = path.join(tempDir, 'texture.png');
    const pngHeader = Buffer.alloc(24);
    pngHeader[0] = 0x89;
    pngHeader[1] = 0x50;
    pngHeader[2] = 0x4e;
    pngHeader[3] = 0x47;
    pngHeader.writeUInt32BE(2048, 8);
    pngHeader.writeUInt32BE(2048, 12);
    fs.writeFileSync(pngPath, Buffer.concat([pngHeader, Buffer.alloc(600 * 1024)]));

    const summary = auditAssetDirectory({ dir: tempDir, maxImageKb: 500, maxAudioKb: 1000 });
    expect(summary.flags.some((flag) => flag.message.includes('WebP alternative'))).toBe(true);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports the correct total bundle size in the summary table', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-auditor-'));
    const pngPath = path.join(tempDir, 'card.png');
    const pngHeader = Buffer.alloc(24);
    pngHeader[0] = 0x89;
    pngHeader[1] = 0x50;
    pngHeader[2] = 0x4e;
    pngHeader[3] = 0x47;
    pngHeader.writeUInt32BE(64, 8);
    pngHeader.writeUInt32BE(64, 12);
    fs.writeFileSync(pngPath, Buffer.concat([pngHeader, Buffer.alloc(200 * 1024)]));

    const summary = auditAssetDirectory({ dir: tempDir, maxImageKb: 500, maxAudioKb: 1000 });
    expect(summary.table).toContain('Total bundle size');
    expect(summary.totalBytes).toBeGreaterThan(0);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
