import { describe, it, expect } from 'vitest';
import { parseContractSource } from './parser';

const SAMPLE_CONTRACT = `
#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

#[contracterror]
pub enum Error {
    NotInitialized = 1,
}

#[contracttype]
pub struct PassRecord {
    pub player: Address,
    pub expiry_ledger: u32,
}

#[contract]
pub struct SubscriptionPass;

#[contractimpl]
impl SubscriptionPass {
    /// Initialize the contract. May only be called once.
    pub fn initialize(env: Env, admin: Address, token: Address, pass_cost: i128, duration_ledgers: u32) -> Result<(), Error> {
        Ok(())
    }

    // A comment with a fake brace { should not confuse the parser.
    pub fn buy_pass(env: Env, player: Address) -> Result<PassRecord, Error> {
        unimplemented!()
    }

    pub fn is_pass_active(env: Env, player: Address) -> bool {
        true
    }

    pub fn admin_configure_tier(
        env: Env,
        admin: Address,
        tier: u32,
        bonus_ledgers: u32,
    ) -> Result<(), Error> {
        Ok(())
    }

    pub fn get_pools(env: Env) -> Vec<Address> {
        Vec::new(&env)
    }

    pub fn no_return(env: Env, player: Address) {
    }
}
`;

// ---------------------------------------------------------------------------
// 1. mock class generation from sample contract Rust source
// ---------------------------------------------------------------------------

describe('parseContractSource: mock class generation from sample contract Rust source', () => {
  it('parses the contract name and every public method', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].contractName).toBe('SubscriptionPass');

    const methodNames = contracts[0].methods.map((m) => m.name);
    expect(methodNames).toEqual([
      'initialize',
      'buy_pass',
      'is_pass_active',
      'admin_configure_tier',
      'get_pools',
      'no_return',
    ]);
  });

  it('excludes the env: Env parameter from parsed params (mocks take no host env)', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const buyPass = contracts[0].methods.find((m) => m.name === 'buy_pass')!;
    expect(buyPass.params).toEqual([{ name: 'player', type: expect.objectContaining({ rustType: 'Address' }) }]);
  });

  it('parses a multi-line method signature spanning several lines', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const method = contracts[0].methods.find((m) => m.name === 'admin_configure_tier')!;
    expect(method.params.map((p) => p.name)).toEqual(['admin', 'tier', 'bonus_ledgers']);
  });

  it('parses a method with no explicit return type as returning void', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const method = contracts[0].methods.find((m) => m.name === 'no_return')!;
    expect(method.returnType).toBeNull();
  });

  it('is not confused by a comment containing a brace character', () => {
    // If the comment-stripping in parser.ts were broken, this contract
    // would fail to parse at all (unmatched brace) rather than silently
    // misparsing, so successfully reaching this assertion is the real
    // proof.
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    expect(contracts[0].methods.some((m) => m.name === 'buy_pass')).toBe(true);
  });

  it('throws a clear error when no #[contractimpl] block is present', () => {
    expect(() => parseContractSource('fn main() {}')).toThrow(/no #\[contractimpl\] block/i);
  });

  it('parses multiple #[contractimpl] blocks in one file', () => {
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
    expect(contracts.map((c) => c.contractName)).toEqual(['First', 'Second']);
  });
});

// ---------------------------------------------------------------------------
// 3. handling of complex struct return types
// ---------------------------------------------------------------------------

describe('parseContractSource: complex struct return types', () => {
  it('maps a Result<CustomStruct, Error> return type to the struct name with a placeholder default', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const buyPass = contracts[0].methods.find((m) => m.name === 'buy_pass')!;
    expect(buyPass.returnType?.rustType).toBe('Result<PassRecord, Error>');
    expect(buyPass.returnType?.tsType).toBe('unknown');
    expect(buyPass.returnType?.defaultValueExpr).toBe('{}');
    expect(buyPass.isResult).toBe(true);
  });

  it('maps Vec<Address> to a typed array with an empty-array default', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const getPools = contracts[0].methods.find((m) => m.name === 'get_pools')!;
    expect(getPools.returnType?.tsType).toBe('string[]');
    expect(getPools.returnType?.defaultValueExpr).toBe('[]');
  });

  it('maps a bare bool return type directly, not wrapped in Result', () => {
    const contracts = parseContractSource(SAMPLE_CONTRACT);
    const isPassActive = contracts[0].methods.find((m) => m.name === 'is_pass_active')!;
    expect(isPassActive.returnType?.tsType).toBe('boolean');
    expect(isPassActive.isResult).toBe(false);
  });

  it('maps a nested generic Option<Vec<Address>> correctly', () => {
    const source = `
      #[contractimpl]
      impl X {
          pub fn f(env: Env) -> Option<Vec<Address>> { None }
      }
    `;
    const contracts = parseContractSource(source);
    const method = contracts[0].methods[0];
    expect(method.returnType?.tsType).toBe('string[] | null');
    expect(method.returnType?.defaultValueExpr).toBe('null');
  });

  it('maps a tuple return type to a TS tuple', () => {
    const source = `
      #[contractimpl]
      impl X {
          pub fn f(env: Env) -> (i128, i128) { (0, 0) }
      }
    `;
    const contracts = parseContractSource(source);
    const method = contracts[0].methods[0];
    expect(method.returnType?.tsType).toBe('[bigint, bigint]');
    expect(method.returnType?.defaultValueExpr).toBe('[0n, 0n]');
  });
});
