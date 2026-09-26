# contract-mock-generator

A standalone CLI and library that generates mock TypeScript Soroban
contract clients from a contract's Rust source, for frontend unit tests
that need a realistic-looking contract client without a real network.

> **Status:** experimental, self-contained tool under `experimental/tools/`.
> It does not modify or depend on any core repo tooling.

## What it parses, and what it doesn't

This tool parses the **public method signatures** of a `#[contractimpl]
impl SomeContract { ... }` block, via a targeted scan (brace/paren
matching plus regex), not a full Rust parser. It does not depend on a Rust
toolchain or the `syn` crate; a full AST parse is out of scope for a
frontend-testing convenience tool.

It handles:

- Every `pub fn` in one or more `#[contractimpl]` blocks in the file.
- Multi-line signatures.
- Parameter and return types: `Env` (excluded from the mock's parameter
  list, since a mock has no real host environment), `Address`, `Symbol`,
  `String`, `Bytes`, `BytesN<N>`, `bool`, the integer family
  (`u32`/`i32`/`u64`/`i64`/`u128`/`i128`/`u256`/`i256`, mapped to
  `bigint` except `u32`/`i32` which map to `number`), `Vec<T>`,
  `Option<T>`, `Result<T, E>` (unwrapped to `T`, since a mock's default
  fixture represents the success path), tuples, and `()`.
- Comments (`//`, `///`, `//!`, `/* */`), which are stripped before
  scanning so a stray `{` or `(` inside a comment can't confuse brace
  matching.

It does **not** parse `#[contracttype]` struct/enum field definitions.
A custom struct or enum return type (e.g. `Result<PassRecord, Error>`) is
mapped to TypeScript's `unknown` with an empty-object (`{}`) default
fixture, not a fully-typed shape. If you need a typed fixture for a
specific struct, override that method's `mockResolvedValueOnce` in your
test with the real shape; there is no way around actually knowing that
struct's fields, which only a full Rust type parse could extract
reliably.

## Generated output

For a contract `EscrowContract`, generates a `MockEscrowContract` class
where every method is a `vi.fn()` resolving to a deterministic default
success fixture:

```ts
import { vi } from 'vitest';

export class MockEscrowContract {
  simulatedLatencyMs = 0;
  private async delay(): Promise<void> { /* ... */ }

  initialize = vi.fn<(admin: string, token: string) => Promise<void>>(async (admin, token) => {
    await this.delay();
    return undefined;
  });

  release = vi.fn<() => Promise<void>>(async () => {
    await this.delay();
    return undefined;
  });
}
```

Override any method per-test with standard vitest mock APIs:

```ts
mockClient.release.mockRejectedValueOnce(new Error('simulated failure'));
mockClient.simulatedLatencyMs = 200; // simulate a slow network for this instance
```

## Installation

```bash
cd experimental/tools/contract-mock-generator
npm install
npm run build
```

## Usage

```bash
contract-mock-generator --source <path/to/lib.rs> [--output <mock.ts>] [--no-latency] [--no-errors]
```

- `--source`: path to the contract's Rust source file.
- `--output`: write the generated TypeScript to a file instead of stdout.
- `--no-latency`: omit the `simulatedLatencyMs`/`delay()` helper from the
  generated class.
- `--no-errors`: omit the error-mocking usage comment (the generated
  methods are still real `vi.fn()`s and can still be made to reject
  regardless of this flag; it only affects the doc comment).

## Library usage

```ts
import { parseContractSource, generateMockFile } from '@stellarcade/contract-mock-generator';

const contracts = parseContractSource(rustSource);
const mockCode = generateMockFile(contracts);
```

## Testing

```bash
npm test
```

Parser tests cover method/parameter extraction, multi-line signatures,
comment handling, and type mapping (including nested generics and tuples).
Generator tests **compile the generated TypeScript with the real
TypeScript compiler** (matching this tool's own "generated files pass
strict tsc compilation" requirement) and instantiate the resulting class,
so the fixture-value and override/reject assertions run against actually
executable generated code, not just its string shape.
