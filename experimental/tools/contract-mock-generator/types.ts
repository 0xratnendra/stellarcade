/**
 * Shared types for the Soroban contract mock generator.
 *
 * This tool parses the PUBLIC METHOD SIGNATURES of a `#[contractimpl] impl
 * SomeContract { ... }` block via a targeted regex/tokenizer scan, not a
 * full Rust parser (a full `syn`-based AST parse is out of scope for a
 * frontend-testing convenience tool, and would require a Rust toolchain
 * this Node CLI doesn't have). It recognizes this workspace's own
 * established contract style (see README for exactly what it does and
 * does not handle, including struct/enum return types).
 */

/** A parsed Rust type, mapped to a TypeScript type and a default fixture
 * value generator. */
export interface ParsedType {
  /** The raw Rust type as written in the source, e.g. `Vec<Address>`. */
  rustType: string;
  /** The mapped TypeScript type, e.g. `string[]`. */
  tsType: string;
  /** A TypeScript source expression producing a default success value of
   * this type, e.g. `[]` or `'0'`. */
  defaultValueExpr: string;
}

export interface ParsedParam {
  name: string;
  type: ParsedType;
}

export interface ParsedMethod {
  name: string;
  params: ParsedParam[];
  /** The parsed return type, or `null` for a method returning `()`
   * (no `->` clause at all). */
  returnType: ParsedType | null;
  /** True if the return type is `Result<T, E>`: the mock's default fixture
   * resolves to `Ok`-shaped success data, and a `--with-errors` generated
   * mock also exposes a way to configure a rejected/error path (see
   * generator.ts). */
  isResult: boolean;
}

export interface ParsedContract {
  /** The Rust struct name the `#[contractimpl]` block is for, e.g.
   * `EscrowContract`. */
  contractName: string;
  methods: ParsedMethod[];
}

export interface GeneratorOptions {
  /** Include a `simulateNetworkLatency` helper and per-method configurable
   * artificial delay in the generated mock. */
  includeLatencySimulation: boolean;
  /** Include a `mockRejectedValueOnce`-style error-injection helper per
   * method. */
  includeErrorMocks: boolean;
}
