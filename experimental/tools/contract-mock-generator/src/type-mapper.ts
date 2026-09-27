import { ParsedType } from '../types';

/** Split a Rust generic argument list on top-level commas only, respecting
 * nested `<...>` and `(...)` so e.g. `Map<Address, Vec<i128>>, u32` splits
 * into two parts, not four. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of input) {
    if (char === '<' || char === '(') depth++;
    if (char === '>' || char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

const PRIMITIVE_MAP: Record<string, ParsedType> = {
  Env: { rustType: 'Env', tsType: 'unknown', defaultValueExpr: 'undefined' },
  Address: { rustType: 'Address', tsType: 'string', defaultValueExpr: "'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'" },
  Symbol: { rustType: 'Symbol', tsType: 'string', defaultValueExpr: "'MOCK_SYMBOL'" },
  String: { rustType: 'String', tsType: 'string', defaultValueExpr: "'mock string'" },
  Bytes: { rustType: 'Bytes', tsType: 'Uint8Array', defaultValueExpr: 'new Uint8Array()' },
  bool: { rustType: 'bool', tsType: 'boolean', defaultValueExpr: 'true' },
  u32: { rustType: 'u32', tsType: 'number', defaultValueExpr: '0' },
  i32: { rustType: 'i32', tsType: 'number', defaultValueExpr: '0' },
  u64: { rustType: 'u64', tsType: 'bigint', defaultValueExpr: '0n' },
  i64: { rustType: 'i64', tsType: 'bigint', defaultValueExpr: '0n' },
  u128: { rustType: 'u128', tsType: 'bigint', defaultValueExpr: '0n' },
  i128: { rustType: 'i128', tsType: 'bigint', defaultValueExpr: '0n' },
  u256: { rustType: 'u256', tsType: 'bigint', defaultValueExpr: '0n' },
  i256: { rustType: 'i256', tsType: 'bigint', defaultValueExpr: '0n' },
};

/**
 * Map a Rust type string (as it appears in a Soroban contract's public
 * method signature) to a TypeScript type + default fixture value.
 *
 * Handles: the primitives above, `BytesN<N>`, `Vec<T>`, `Option<T>`,
 * `Result<T, E>`, and any other identifier (treated as a custom
 * struct/enum: mapped to `unknown` with an empty-object default, since
 * this tool does not parse struct/enum field definitions — see README).
 */
export function mapRustType(rustType: string): ParsedType {
  const trimmed = rustType.trim();

  if (PRIMITIVE_MAP[trimmed]) return PRIMITIVE_MAP[trimmed];

  const bytesNMatch = trimmed.match(/^BytesN<\s*(\d+)\s*>$/);
  if (bytesNMatch) {
    return { rustType: trimmed, tsType: 'Uint8Array', defaultValueExpr: `new Uint8Array(${bytesNMatch[1]})` };
  }

  const vecMatch = trimmed.match(/^Vec<\s*(.+)\s*>$/);
  if (vecMatch) {
    const inner = mapRustType(vecMatch[1]);
    return { rustType: trimmed, tsType: `${inner.tsType}[]`, defaultValueExpr: '[]' };
  }

  const optionMatch = trimmed.match(/^Option<\s*(.+)\s*>$/);
  if (optionMatch) {
    const inner = mapRustType(optionMatch[1]);
    return { rustType: trimmed, tsType: `${inner.tsType} | null`, defaultValueExpr: 'null' };
  }

  const resultMatch = trimmed.match(/^Result<\s*(.+)\s*>$/);
  if (resultMatch) {
    const [okType] = splitTopLevel(resultMatch[1]);
    const inner = mapRustType(okType ?? '()');
    return { rustType: trimmed, tsType: inner.tsType, defaultValueExpr: inner.defaultValueExpr };
  }

  if (trimmed === '()') {
    return { rustType: '()', tsType: 'void', defaultValueExpr: 'undefined' };
  }

  // A tuple type, e.g. `(i128, i128)`.
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = splitTopLevel(trimmed.slice(1, -1)).map(mapRustType);
    return {
      rustType: trimmed,
      tsType: `[${inner.map((i) => i.tsType).join(', ')}]`,
      defaultValueExpr: `[${inner.map((i) => i.defaultValueExpr).join(', ')}]`,
    };
  }

  // Anything else: a custom struct/enum this tool doesn't parse the
  // fields of. Map to `unknown` with an empty-object placeholder rather
  // than guessing at a shape.
  return { rustType: trimmed, tsType: 'unknown', defaultValueExpr: '{}' };
}
