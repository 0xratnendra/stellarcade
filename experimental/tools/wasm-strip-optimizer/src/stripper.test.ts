import { describe, it, expect } from 'vitest';
import { stripWasmBuffer, parseWasmSections } from './index';

function createMockCustomSection(name: string, payloadData = Buffer.from('mock-data')): Buffer {
  const nameBuf = Buffer.from(name, 'utf-8');
  const nameLenBuf = Buffer.from([nameBuf.length]);
  const customPayload = Buffer.concat([nameLenBuf, nameBuf, payloadData]);
  const sectionIdBuf = Buffer.from([0]);
  const sizeBuf = Buffer.from([customPayload.length]);
  return Buffer.concat([sectionIdBuf, sizeBuf, customPayload]);
}

function createMockWasm(customSections: { name: string; data?: Buffer }[]): Buffer {
  const magic = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const sectionsBufs = customSections.map((s) => createMockCustomSection(s.name, s.data));
  return Buffer.concat([magic, ...sectionsBufs]);
}

describe('wasm-strip-optimizer', () => {
  it('strips debug and producers sections while preserving contractspecv0', () => {
    const mockWasm = createMockWasm([
      { name: 'name' },
      { name: 'producers' },
      { name: 'contractspecv0', data: Buffer.from('soroban-spec-bytes') },
      { name: 'contractenvmetav0', data: Buffer.from('soroban-env-bytes') },
    ]);

    const result = stripWasmBuffer(mockWasm, true);

    expect(result.removedSections).toContain('name');
    expect(result.removedSections).toContain('producers');
    expect(result.preservedSections).toContain('contractspecv0');
    expect(result.preservedSections).toContain('contractenvmetav0');
    expect(result.bytesSaved).toBeGreaterThan(0);
    expect(result.outputBuffer.length).toBeLessThan(result.originalSize);
  });

  it('preserves header integrity and section parsing on stripped binary', () => {
    const mockWasm = createMockWasm([
      { name: 'producers' },
      { name: 'contractspecv0', data: Buffer.from('spec') },
    ]);

    const result = stripWasmBuffer(mockWasm, true);
    const parsedSections = parseWasmSections(result.outputBuffer);

    expect(parsedSections.length).toBe(1);
    expect(parsedSections[0].name).toBe('contractspecv0');
  });

  it('calculates size savings accurately', () => {
    const mockWasm = createMockWasm([
      { name: 'name', data: Buffer.alloc(100) },
      { name: 'contractspecv0', data: Buffer.alloc(50) },
    ]);

    const result = stripWasmBuffer(mockWasm, true);
    expect(result.originalSize).toBe(mockWasm.length);
    expect(result.strippedSize).toBe(result.outputBuffer.length);
    expect(result.bytesSaved).toBe(result.originalSize - result.strippedSize);
    expect(result.percentSaved).toBeGreaterThan(0);
  });
});
