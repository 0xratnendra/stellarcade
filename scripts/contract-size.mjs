#!/usr/bin/env node
/**
 * Report optimised wasm sizes for deployable contracts and fail before
 * Soroban's upload limit is reached.
 *
 * Usage: node scripts/contract-size.mjs [--limit-kb N]
 *
 * Default network wasm size limit: 64 KB (Soroban mainnet). Override with
 * --limit-kb for testnets or future limit changes.
 */

import { execSync } from "node:child_process";
import { existsSync, statSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONTRACTS_DIR = join(ROOT, "contracts");
const TARGET_DIR = join(CONTRACTS_DIR, "target", "wasm32v1-none", "release");

const DEFAULT_LIMIT_KB = 64;
const THRESHOLD = 0.9;

const CONTRACTS = [
  "stellarcade-coin-flip",
  "stellarcade-random-generator",
  "stellarcade-prize-pool",
];

// dice-roll is excluded from the workspace; build via its own manifest.
const EXCLUDED = [
  { pkg: "stellarcade-dice-roll", dir: "dice-roll" },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let limitKb = DEFAULT_LIMIT_KB;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit-kb" && args[i + 1]) {
      limitKb = parseFloat(args[i + 1]);
      i++;
    }
  }
  return { limitKb };
}

function buildContracts() {
  console.error("Building contracts (wasm32v1-none release)...");
  execSync(
    `cargo build --target wasm32v1-none --release --locked --manifest-path ${join(CONTRACTS_DIR, "Cargo.toml")} -p ${CONTRACTS.join(" -p ")}`,
    { stdio: "inherit", cwd: CONTRACTS_DIR }
  );
  for (const { pkg, dir } of EXCLUDED) {
    console.error(`Building ${pkg} (excluded crate)...`);
    execSync(
      `cargo build --target wasm32v1-none --release --manifest-path ${join(CONTRACTS_DIR, dir, "Cargo.toml")}`,
      { stdio: "inherit", cwd: join(CONTRACTS_DIR, dir) }
    );
  }
}

function measure() {
  const all = [
    ...CONTRACTS.map((pkg) => ({ pkg, targetDir: TARGET_DIR })),
    ...EXCLUDED.map(({ pkg, dir }) => ({
      pkg,
      targetDir: join(CONTRACTS_DIR, dir, "target", "wasm32v1-none", "release"),
    })),
  ];
  return all.map(({ pkg, targetDir }) => {
    const wasmName = pkg.replace(/-/g, "_") + ".wasm";
    const path = join(targetDir, wasmName);
    if (!existsSync(path)) {
      return { name: pkg, sizeKb: null, path: null };
    }
    const bytes = statSync(path).size;
    return { name: pkg, sizeKb: bytes / 1024, path };
  });
}

function formatKb(kb) {
  return kb === null ? "N/A" : kb.toFixed(1);
}

function printTable(results, limitKb) {
  const thresholdKb = limitKb * THRESHOLD;
  const lines = [];
  lines.push(`| Contract | Size (KB) | Limit (KB) | Status |`);
  lines.push(`|----------|-----------|------------|--------|`);
  for (const r of results) {
    const status =
      r.sizeKb === null
        ? "MISSING"
        : r.sizeKb > limitKb
          ? "OVER LIMIT"
          : r.sizeKb > thresholdKb
            ? "NEAR LIMIT"
            : "OK";
    lines.push(
      `| ${r.name} | ${formatKb(r.sizeKb)} | ${limitKb.toFixed(1)} | ${status} |`
    );
  }
  return lines.join("\n");
}

function main() {
  const { limitKb } = parseArgs();
  const thresholdKb = limitKb * THRESHOLD;

  buildContracts();
  const results = measure();

  const table = printTable(results, limitKb);
  console.log(table);

  // Also write to GitHub Actions job summary if available.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(
      summaryPath,
      `## Contract wasm sizes\n\n${table}\n\n*Threshold: ${thresholdKb.toFixed(1)} KB (90% of ${limitKb} KB limit)*\n`
    );
  }

  let failed = false;
  for (const r of results) {
    if (r.sizeKb === null) {
      console.error(`ERROR: wasm not found for ${r.name}`);
      failed = true;
    } else if (r.sizeKb > limitKb) {
      console.error(
        `ERROR: ${r.name} is ${formatKb(r.sizeKb)} KB, exceeding the ${limitKb} KB limit`
      );
      failed = true;
    } else if (r.sizeKb > thresholdKb) {
      console.warn(
        `WARNING: ${r.name} is ${formatKb(r.sizeKb)} KB, above 90% of the ${limitKb} KB limit (${thresholdKb.toFixed(1)} KB)`
      );
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main();
