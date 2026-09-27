import { describe, it, expect } from 'vitest';
import {
  scanFileContent,
  isFixtureOrTestPath,
} from './index';

describe('keypair-hygiene-linter', () => {
  it('detects valid Stellar secret seed format (S-prefix 56 base32 chars)', () => {
    // Valid 56-char base32 Stellar secret seed
    const secretSeed = 'SDJ72TQXH4J6C2RPA5N7G3PXL2Y9WVKF8M4E6U1B3O5I7L9K0J2H4G6F';
    const sampleCode = `
      const config = {
        adminSecret: "${secretSeed}",
      };
    `;

    const matches = scanFileContent(sampleCode, 'src/config.ts');
    expect(matches.length).toBe(1);
    expect(matches[0].secretType).toBe('stellar-secret-seed');
    expect(matches[0].lineNumber).toBe(3);
  });

  it('ignores public addresses (G-prefix 56 base32 chars)', () => {
    const publicKey = 'GAY2TQXH4J6C2RPA5N7G3PXL2Y9WVKF8M4E6U1B3O5I7L9K0J2H4G6F';
    const sampleCode = `
      const contractAddress = "${publicKey}";
    `;

    const matches = scanFileContent(sampleCode, 'src/config.ts');
    expect(matches.length).toBe(0);
  });

  it('excludes explicit fixture comments //@fixture', () => {
    const secretSeed = 'SDJ72TQXH4J6C2RPA5N7G3PXL2Y9WVKF8M4E6U1B3O5I7L9K0J2H4G6F';
    const sampleCode = `
      // @fixture mock secret for local test
      const testSecret = "${secretSeed}";
    `;

    const matches = scanFileContent(sampleCode, 'src/config.ts');
    expect(matches.length).toBe(0);
  });

  it('identifies fixture directory paths correctly', () => {
    expect(isFixtureOrTestPath('src/__fixtures__/test-keys.ts')).toBe(true);
    expect(isFixtureOrTestPath('src/hooks/useWallet.test.ts')).toBe(true);
    expect(isFixtureOrTestPath('src/services/wallet.ts')).toBe(false);
  });
});
