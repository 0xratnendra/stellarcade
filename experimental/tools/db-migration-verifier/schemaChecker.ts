import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PrismaField, PrismaModel, SchemaCheckResult, SchemaIssue } from './types';

const walkDirectory = (rootDir: string): string[] => {
  const files: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const parsePrismaModels = (schemaText: string): PrismaModel[] => {
  const models: PrismaModel[] = [];
  const modelMatches = [...schemaText.matchAll(/model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g)];

  for (const match of modelMatches) {
    const name = match[1];
    const body = match[2];
    const fields: PrismaField[] = [];
    const indexes: string[] = [];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) {
        continue;
      }

      if (line.startsWith('@@index')) {
        indexes.push(line);
        continue;
      }

      const fieldMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)(?:\s*@.*)?$/);
      if (!fieldMatch) {
        continue;
      }

      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2].trim();
      const relationFields = [...fieldType.matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g)].map((entry) => entry[1]);
      const isRelation = /@relation|\b[A-Z][A-Za-z0-9_]*\s*\[\]/.test(line) || /^[A-Z]/.test(fieldType.split(' ')[0] ?? '');

      fields.push({
        name: fieldName,
        type: fieldType,
        raw: line,
        isRelation,
        relationFields,
      });
    }

    models.push({ name, fields, indexes });
  }

  return models;
};

const scanMigrationSql = (migrationDir: string): SchemaIssue[] => {
  const issues: SchemaIssue[] = [];
  if (!fs.existsSync(migrationDir)) {
    return issues;
  }

  const files = walkDirectory(migrationDir).filter((file) => file.endsWith('.sql'));
  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8');
    const destructivePatterns = [/DROP TABLE/i, /DROP COLUMN/i, /ALTER TABLE[\s\S]*DROP COLUMN/i];
    for (const pattern of destructivePatterns) {
      if (pattern.test(sql)) {
        issues.push({
          severity: 'warning',
          file,
          message: 'SQL migration contains destructive operations such as DROP TABLE or DROP COLUMN.',
        });
      }
    }
  }

  return issues;
};

export const verifySchemaConsistency = (schemaPath: string, migrationDir: string, strict = false): SchemaCheckResult => {
  const issues: SchemaIssue[] = [];
  const rawSchema = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';
  const models = parsePrismaModels(rawSchema);

  for (const model of models) {
    const relationFields = model.fields.filter((field) => field.isRelation || field.raw.includes('@relation'));
    for (const field of relationFields) {
      const indexColumns = field.relationFields.length > 0 ? field.relationFields : [field.name];
      const hasExplicitIndex = model.indexes.some((entry) =>
        indexColumns.some((column) => entry.toLowerCase().includes(column.toLowerCase())),
      );

      if (!hasExplicitIndex) {
        issues.push({
          severity: strict ? 'error' : 'warning',
          file: schemaPath,
          message: `Model ${model.name} has a relational field (${field.name}) without a matching index definition.`,
        });
      }
    }
  }

  issues.push(...scanMigrationSql(migrationDir));

  const valid = issues.every((issue) => issue.severity !== 'error' && issue.severity !== 'warning');
  return { valid, issues, models };
};

export const printSchemaReport = (schemaPath: string, migrationDir: string, strict = false): string => {
  const result = verifySchemaConsistency(schemaPath, migrationDir, strict);
  const lines = ['Schema verification report', `Status: ${result.valid ? 'OK' : 'WARNINGS'}`];
  for (const issue of result.issues) {
    lines.push(`[${issue.severity.toUpperCase()}] ${issue.file}: ${issue.message}`);
  }
  return lines.join('\n');
};
