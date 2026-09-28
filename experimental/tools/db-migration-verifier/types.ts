export type Severity = 'warning' | 'error' | 'info';

export interface SchemaIssue {
  severity: Severity;
  file: string;
  message: string;
}

export interface PrismaModel {
  name: string;
  fields: PrismaField[];
  indexes: string[];
}

export interface PrismaField {
  name: string;
  type: string;
  raw: string;
  isRelation: boolean;
  relationFields: string[];
}

export interface SchemaCheckResult {
  valid: boolean;
  issues: SchemaIssue[];
  models: PrismaModel[];
}
