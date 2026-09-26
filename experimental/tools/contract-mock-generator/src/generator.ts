import { GeneratorOptions, ParsedContract, ParsedMethod } from '../types';

const DEFAULT_OPTIONS: GeneratorOptions = { includeLatencySimulation: true, includeErrorMocks: true };

function methodSignature(method: ParsedMethod): string {
  const params = method.params.map((p) => `${p.name}: ${p.type.tsType}`).join(', ');
  const returnType = method.returnType ? `Promise<${method.returnType.tsType}>` : 'Promise<void>';
  return `(${params}) => ${returnType}`;
}

function defaultFixtureExpr(method: ParsedMethod): string {
  return method.returnType ? method.returnType.defaultValueExpr : 'undefined';
}

/**
 * Generate a mock TypeScript client class for one parsed contract: every
 * method is an overridable `vi.fn()` returning a deterministic default
 * success fixture, so a frontend test can call the real-looking method
 * without a real network, and override any method's behavior per-test via
 * standard vitest mock APIs (`mockResolvedValueOnce`, etc.).
 */
export function generateMockClient(contract: ParsedContract, options: GeneratorOptions = DEFAULT_OPTIONS): string {
  const className = `Mock${contract.contractName}`;
  const lines: string[] = [];

  lines.push("import { vi } from 'vitest';", '');
  lines.push(`/**`);
  lines.push(` * Generated mock client for ${contract.contractName}.`);
  lines.push(` * DO NOT EDIT BY HAND — regenerate with contract-mock-generator.`);
  lines.push(` *`);
  lines.push(` * Every method is a vi.fn() resolving to a default success fixture.`);
  lines.push(` * Override per-test with e.g.:`);
  lines.push(` *   mockClient.someMethod.mockResolvedValueOnce(customValue);`);
  if (options.includeErrorMocks) {
    lines.push(` *   mockClient.someMethod.mockRejectedValueOnce(new Error('simulated failure'));`);
  }
  lines.push(` */`);
  lines.push(`export class ${className} {`);

  if (options.includeLatencySimulation) {
    lines.push('  /** Artificial network latency (ms) applied before every mocked call resolves. Defaults to 0 (instant) for fast tests; set per-instance to simulate a slow network. */');
    lines.push('  simulatedLatencyMs = 0;', '');
    lines.push('  private async delay(): Promise<void> {');
    lines.push('    if (this.simulatedLatencyMs > 0) {');
    lines.push('      await new Promise((resolve) => setTimeout(resolve, this.simulatedLatencyMs));');
    lines.push('    }');
    lines.push('  }', '');
  }

  for (const method of contract.methods) {
    const signature = methodSignature(method);
    const fixture = defaultFixtureExpr(method);
    lines.push(`  /** Mock for \`${method.name}\`. Rust signature returned: ${method.returnType?.rustType ?? '()'} */`);
    if (options.includeLatencySimulation) {
      lines.push(`  ${method.name} = vi.fn<${signature}>(async (${method.params.map((p) => p.name).join(', ')}) => {`);
      lines.push('    await this.delay();');
      lines.push(`    return ${fixture};`);
      lines.push('  });');
    } else {
      lines.push(`  ${method.name} = vi.fn<${signature}>(async () => ${fixture});`);
    }
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}

export function generateMockFile(contracts: ParsedContract[], options: GeneratorOptions = DEFAULT_OPTIONS): string {
  return contracts.map((c) => generateMockClient(c, options)).join('\n\n');
}
