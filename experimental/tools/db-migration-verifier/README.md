# DB Migration Verifier

A read-only Prisma schema and SQL migration linter focused on drift, foreign-key coverage, and destructive operations.

## Usage

```bash
cd experimental/tools/db-migration-verifier
npm install
npm run build
node dist/cli.js --schema ./schema.prisma --migrations ./prisma/migrations --strict
```

The tool checks for:

- unindexed relational fields
- destructive migration commands such as `DROP TABLE` and `DROP COLUMN`
- naming drift in Prisma models and SQL names
