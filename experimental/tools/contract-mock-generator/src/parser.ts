import { ParsedContract, ParsedMethod, ParsedParam } from '../types';
import { mapRustType } from './type-mapper';

/** Strip Rust line and block comments, and doc comments (`///`, `//!`),
 * so they can't confuse brace/paren matching below (a comment containing
 * an unmatched `{` or `(` would otherwise throw off the scan). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** Find the matching closing brace for the `{` at `openIndex`. */
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unmatched brace in source: no closing } found for #[contractimpl] block');
}

/** Find the matching closing paren for the `(` at `openIndex`. */
function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unmatched parenthesis in a method signature');
}

/** Parse a single parameter, e.g. `env: Env` or `admin_signers: Vec<Address>`. */
function parseParam(raw: string): ParsedParam | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex === -1) return null; // e.g. `&self` in a non-static method, not expected in Soroban contracts
  const name = trimmed.slice(0, colonIndex).trim();
  const rustType = trimmed.slice(colonIndex + 1).trim();
  return { name, type: mapRustType(rustType) };
}

/**
 * Parse every `pub fn` method inside one `#[contractimpl] impl X { ... }`
 * block's body (the substring between, but not including, its outer
 * braces).
 */
function parseMethods(implBody: string): ParsedMethod[] {
  const methods: ParsedMethod[] = [];
  const fnStartRegex = /pub\s+fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = fnStartRegex.exec(implBody)) !== null) {
    const name = match[1];
    const parenOpen = match.index + match[0].length - 1;
    const parenClose = findMatchingParen(implBody, parenOpen);
    const paramsRaw = implBody.slice(parenOpen + 1, parenClose);

    const params = splitParams(paramsRaw)
      .map(parseParam)
      .filter((p): p is ParsedParam => p !== null)
      // Soroban contract methods always take `env: Env` first; excluded
      // from the generated mock's parameter list since a mock has no real
      // host environment to receive.
      .filter((p) => p.type.rustType !== 'Env');

    // Everything between the closing `)` and the method's own opening `{`
    // (or `;` for a trait-only declaration, not expected here) is the
    // optional `-> ReturnType` clause.
    const afterParams = implBody.slice(parenClose + 1);
    const bodyStart = afterParams.search(/[{;]/);
    const signatureTail = bodyStart === -1 ? afterParams : afterParams.slice(0, bodyStart);
    const returnMatch = signatureTail.match(/->\s*(.+)$/s);
    const returnRustType = returnMatch ? returnMatch[1].trim() : null;

    methods.push({
      name,
      params,
      returnType: returnRustType ? mapRustType(returnRustType) : null,
      isResult: returnRustType !== null && /^Result</.test(returnRustType),
    });
  }

  return methods;
}

/** Split a parameter list on top-level commas (respecting nested `<>`),
 * so `pool: LiquidityPool` and `path: Vec<Address>, deadline: u32` don't
 * get split on commas inside a generic argument. */
function splitParams(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of input) {
    if (char === '<') depth++;
    if (char === '>') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

/**
 * Parse every `#[contractimpl] impl ContractName { ... }` block in a
 * Soroban contract's `lib.rs` (or any Rust source file following the same
 * convention). A file may declare more than one contract; all are
 * returned. Throws if no `#[contractimpl]` block is found at all, since a
 * caller almost certainly pointed this at the wrong file.
 */
export function parseContractSource(source: string): ParsedContract[] {
  const cleaned = stripComments(source);
  const contracts: ParsedContract[] = [];

  const implStartRegex = /#\[contractimpl\]\s*impl\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = implStartRegex.exec(cleaned)) !== null) {
    const contractName = match[1];
    const braceOpen = match.index + match[0].length - 1;
    const braceClose = findMatchingBrace(cleaned, braceOpen);
    const implBody = cleaned.slice(braceOpen + 1, braceClose);

    contracts.push({ contractName, methods: parseMethods(implBody) });
  }

  if (contracts.length === 0) {
    throw new Error('No #[contractimpl] block found in the provided source. Is this a Soroban contract lib.rs?');
  }

  return contracts;
}
