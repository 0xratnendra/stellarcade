import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifySchemaConsistency } from './schemaChecker';

describe('db migration verifier', () => {
  it('detects an unindexed foreign key in the model definition', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-verifier-'));
    const prismaPath = path.join(tempDir, 'schema.prisma');
    fs.writeFileSync(
      prismaPath,
      `model User {\n  id String @id\n  posts Post[]\n}\n\nmodel Post {\n  id String @id\n  userId String\n  user User @relation(fields: [userId], references: [id])\n}\n`,
    );

    const result = verifySchemaConsistency(prismaPath, tempDir);
    expect(result.issues.some((issue) => issue.message.includes('without a matching index'))).toBe(true);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('flags destructive SQL operations in migration files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-verifier-'));
    const prismaPath = path.join(tempDir, 'schema.prisma');
    fs.writeFileSync(
      prismaPath,
      `model User {\n  id String @id\n  posts Post[]\n  @@index([id])\n}\n\nmodel Post {\n  id String @id\n  userId String\n  user User @relation(fields: [userId], references: [id])\n  @@index([userId])\n}\n`,
    );

    const migrationDir = path.join(tempDir, 'prisma', 'migrations');
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(path.join(migrationDir, '20240101000000_drop_users.sql'), 'ALTER TABLE users DROP COLUMN status;');

    const result = verifySchemaConsistency(prismaPath, migrationDir);
    expect(result.issues.some((issue) => issue.message.includes('DROP'))).toBe(true);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a clean result when the schema is consistent', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-verifier-'));
    const prismaPath = path.join(tempDir, 'schema.prisma');
    fs.writeFileSync(
      prismaPath,
      `model User {\n  id String @id\n  posts Post[]\n  @@index([id])\n}\n\nmodel Post {\n  id String @id\n  userId String\n  user User @relation(fields: [userId], references: [id])\n  @@index([userId])\n}\n`,
    );

    const result = verifySchemaConsistency(prismaPath, tempDir);
    expect(result.valid).toBe(true);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
