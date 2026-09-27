import fs from 'fs';
import path from 'path';

export interface StripOptions {
  input: string;
  output?: string;
  keepSpec?: boolean;
}

export interface WasmSection {
  id: number;
  name?: string;
  start: number;
  size: number;
  payload: Buffer;
}

export interface StripResult {
  originalSize: number;
  strippedSize: number;
  bytesSaved: number;
  percentSaved: number;
  removedSections: string[];
  preservedSections: string[];
  outputBuffer: Buffer;
}

// WASM binary magic header: \0asm\1\0\0\0
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

// Essential Soroban spec sections that must be preserved
export const ESSENTIAL_SOROBAN_SECTIONS = [
  'contractenvmetav0',
  'contractspecv0',
];

// Default debug and non-essential sections to strip
export const STRIP_TARGET_SECTIONS = [
  'name',
  'producers',
  'target_features',
  'debug_info',
  '.debug_info',
  '.debug_pubnames',
  '.debug_pubtypes',
  '.debug_aranges',
  '.debug_line',
  '.debug_str',
  '.debug_loc',
  '.debug_ranges',
];

function readLeb128(buffer: Buffer, offset: number): { value: number; bytesRead: number } {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buffer.length) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, bytesRead };
}

function writeLeb128(value: number): Buffer {
  const bytes: number[] = [];
  let val = value;
  do {
    let byte = val & 0x7f;
    val >>>= 7;
    if (val !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (val !== 0);
  return Buffer.from(bytes);
}

export function parseWasmSections(buffer: Buffer): WasmSection[] {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(WASM_MAGIC)) {
    throw new Error('Invalid WASM binary: magic header mismatch');
  }

  const sections: WasmSection[] = [];
  let offset = 8;

  while (offset < buffer.length) {
    const sectionStart = offset;
    const id = buffer[offset++];
    const { value: size, bytesRead } = readLeb128(buffer, offset);
    offset += bytesRead;

    const payloadStart = offset;
    const payload = buffer.subarray(payloadStart, payloadStart + size);
    offset += size;

    let name: string | undefined;
    if (id === 0) {
      // Custom section: first field is name_len (LEB128) + name_utf8
      try {
        const { value: nameLen, bytesRead: nameLenBytes } = readLeb128(payload, 0);
        name = payload.subarray(nameLenBytes, nameLenBytes + nameLen).toString('utf-8');
      } catch {
        name = undefined;
      }
    }

    sections.push({
      id,
      name,
      start: sectionStart,
      size,
      payload,
    });
  }

  return sections;
}

export function stripWasmBuffer(inputBuffer: Buffer, keepSpec = true): StripResult {
  if (inputBuffer.length < 8 || !inputBuffer.subarray(0, 8).equals(WASM_MAGIC)) {
    throw new Error('Invalid WASM binary: magic header mismatch');
  }

  const sections = parseWasmSections(inputBuffer);
  const removedSections: string[] = [];
  const preservedSections: string[] = [];
  const keptPayloads: Buffer[] = [WASM_MAGIC];

  for (const section of sections) {
    let shouldStrip = false;
    if (section.id === 0 && section.name) {
      const isEssential = keepSpec && ESSENTIAL_SOROBAN_SECTIONS.includes(section.name);
      const isStripTarget = STRIP_TARGET_SECTIONS.includes(section.name) || section.name.startsWith('.debug');

      if (!isEssential && isStripTarget) {
        shouldStrip = true;
      }
    }

    if (shouldStrip) {
      if (section.name) removedSections.push(section.name);
    } else {
      if (section.id === 0 && section.name) {
        preservedSections.push(section.name);
      }
      const sectionIdBuf = Buffer.from([section.id]);
      const sizeBuf = writeLeb128(section.payload.length);
      keptPayloads.push(sectionIdBuf, sizeBuf, section.payload);
    }
  }

  const outputBuffer = Buffer.concat(keptPayloads);
  const originalSize = inputBuffer.length;
  const strippedSize = outputBuffer.length;
  const bytesSaved = originalSize - strippedSize;
  const percentSaved = originalSize > 0 ? Number(((bytesSaved / originalSize) * 100).toFixed(2)) : 0;

  return {
    originalSize,
    strippedSize,
    bytesSaved,
    percentSaved,
    removedSections,
    preservedSections,
    outputBuffer,
  };
}

export function stripWasmFile(options: StripOptions): StripResult {
  const inputBuffer = fs.readFileSync(options.input);
  const result = stripWasmBuffer(inputBuffer, options.keepSpec ?? true);

  if (options.output) {
    const outDir = path.dirname(options.output);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(options.output, result.outputBuffer);
  }

  return result;
}

// Minimal CLI runner
if (require.main === module) {
  const args = process.argv.slice(2);
  let input = '';
  let output = '';
  let keepSpec = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      input = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      output = args[++i];
    } else if (args[i] === '--no-keep-spec') {
      keepSpec = false;
    }
  }

  if (!input) {
    console.error('Usage: wasm-strip-optimizer --input <path> [--output <path>] [--keep-spec]');
    process.exit(1);
  }

  try {
    const result = stripWasmFile({ input, output, keepSpec });
    console.log(`Original Size:  ${result.originalSize} B`);
    console.log(`Stripped Size:  ${result.strippedSize} B`);
    console.log(`Saved:          ${result.bytesSaved} B (${result.percentSaved}%)`);
    console.log(`Removed:        ${result.removedSections.join(', ') || 'None'}`);
    console.log(`Preserved Spec: ${result.preservedSections.join(', ') || 'None'}`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
