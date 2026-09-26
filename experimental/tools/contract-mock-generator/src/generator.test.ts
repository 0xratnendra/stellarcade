import { describe, it, expect, vi } from 'vitest';
import * as ts from 'typescript';
import { parseContractSource } from './parser';
import { generateMockClient, generateMockFile } from './generator';

const SAMPLE_CONTRACT = `
#[contractimpl]
impl SubscriptionPass {
    pub fn initialize(env: Env, admin: Address, pass_cost: i128, duration_ledgers: u32) -> Result<(), Error> {
        Ok(())
    }

    pub fn buy_pass(env: Env, player: Address) -> Result<PassRecord, Error> {
        unimplemented!()
    }

    pub fn is_pass_active(env: Env, player: Address) -> bool {
        true
    }

    pub fn get_pools(env: Env) -> Vec<Address> {
        Vec::new(&env)
    }
}
`;

/**
 * Compile a generated mock TS file with the REAL TypeScript compiler
 * (matching the issue's "generated TypeScript files pass strict tsc
 * compilation" acceptance criterion), strip the module import, and
 * instantiate the resulting class so tests exercise actually-compiled
 * generated code, not just its string shape.
 */
function loadClass(source: string, contractName: string) {
  const contracts = parseContractSource(source);
  const contract = contracts.find((c) => c.contractName === contractName)!;
  const code = generateMockClient(contract);

  const { outputText, diagnostics } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, strict: true },
    reportDiagnostics: true,
  });
  const errors = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    throw new Error(`Generated mock failed to compile: ${errors.map((d) => d.messageText).join('; ')}`);
  }

  const moduleExports: Record<string, unknown> = {};
  const fakeRequire = (name: string) => {
    if (name === 'vitest') return { vi };
    throw new Error(`Unexpected require("${name}") from generated mock code`);
  };
  const factory = new Function('exports', 'require', outputText);
  factory(moduleExports, fakeRequire);
  return moduleExports[`Mock${contractName}`];
}

// ---------------------------------------------------------------------------
// 2. generated mock methods return expected fixture data
// ---------------------------------------------------------------------------

describe('generateMockClient: generated mock methods return expected fixture data', () => {
  it('produces valid generated source containing a vi.fn() per method', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const code = generateMockClient(contracts[0]);

    expect(code).toContain('export class MockSubscriptionPass');
    expect(code).toContain('initialize = vi.fn');
    expect(code).toContain('buy_pass = vi.fn');
    expect(code).toContain('is_pass_active = vi.fn');
    expect(code).toContain('get_pools = vi.fn');
  });

  it('an instantiated generated mock resolves each method to its default fixture', async () => {
    const MockClass = loadClass(SAMPLE_CONTRACT, 'SubscriptionPass');
    const instance = new MockClass();

    await expect(instance.is_pass_active('GABC')).resolves.toBe(true);
    await expect(instance.get_pools()).resolves.toEqual([]);
    await expect(instance.buy_pass('GABC')).resolves.toEqual({});
    await expect(instance.initialize('GADMIN', 100n, 1000)).resolves.toEqual(undefined);
  });

  it('an instantiated generated mock method is overridable per-test, like any vi.fn()', async () => {
    const MockClass = loadClass(SAMPLE_CONTRACT, 'SubscriptionPass');
    const instance = new MockClass();

    instance.is_pass_active.mockResolvedValueOnce(false);
    await expect(instance.is_pass_active('GABC')).resolves.toBe(false);
    // Subsequent calls fall back to the default fixture again.
    await expect(instance.is_pass_active('GABC')).resolves.toBe(true);
  });

  it('an instantiated generated mock method can be made to reject, like any vi.fn()', async () => {
    const MockClass = loadClass(SAMPLE_CONTRACT, 'SubscriptionPass');
    const instance = new MockClass();

    instance.buy_pass.mockRejectedValueOnce(new Error('insufficient balance'));
    await expect(instance.buy_pass('GABC')).rejects.toThrow('insufficient balance');
  });

  it('respects simulatedLatencyMs by delaying resolution', async () => {
    const MockClass = loadClass(SAMPLE_CONTRACT, 'SubscriptionPass');
    const instance = new MockClass();
    instance.simulatedLatencyMs = 20;

    const start = Date.now();
    await instance.is_pass_active('GABC');
    expect(Date.now() - start).toBeGreaterThanOrEqual(15); // allow small scheduling slack
  });

  it('omits the latency helper when includeLatencySimulation is false', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const code = generateMockClient(contracts[0], { includeLatencySimulation: false, includeErrorMocks: true });
    expect(code).not.toContain('simulatedLatencyMs');
    expect(code).not.toContain('this.delay()');
  });

  it('generateMockFile concatenates multiple contracts into one output', () => {
    const twoContracts = `
      #[contractimpl]
      impl First {
          pub fn a(env: Env) -> u32 { 0 }
      }
      #[contractimpl]
      impl Second {
          pub fn b(env: Env) -> bool { true }
      }
    `;
    const contracts = parseContractSource(twoContracts);
    const combined = generateMockFile(contracts);
    expect(combined).toContain('export class MockFirst');
    expect(combined).toContain('export class MockSecond');
  });
});
