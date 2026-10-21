#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const backendRoot = path.resolve(__dirname, '..');
const routesDir = path.join(backendRoot, 'src', 'routes');
const serverFile = path.join(backendRoot, 'src', 'server.js');
const routesIndexFile = path.join(routesDir, 'index.js');
const specFile = path.join(backendRoot, 'openapi.yaml');

const routeDocsRegex = /const routeDocs = (\[[\s\S]*?\n\]);/;
const routeLineRegex =
  /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]\s*,\s*([\s\S]+?)\);/g;
const requireRegex = /const\s+(\w+)\s*=\s*require\(['"](.+)['"]\);/g;
const mountRegex = /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\);/g;
const healthRouteRegex = /app\.get\(\s*['"]([^'"]+)['"]\s*,/;
const routerHealthRouteRegex = /router\.get\(\s*['"]([^'"]+)['"]\s*,\s*healthCheck\s*\)/;

const defaultErrorResponse = {
  description: 'Unexpected server error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorEnvelope' },
    },
  },
};

const components = {
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT access token passed in the Authorization header as Bearer <token>.',
    },
  },
  schemas: {
    ErrorEnvelope: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['message', 'code', 'status'],
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
            status: { type: 'integer' },
          },
        },
      },
    },
    AuthErrorResponse: {
      type: 'object',
      required: ['message'],
      properties: {
        message: {
          type: 'string',
          enum: ['No token provided', 'Invalid token'],
        },
      },
    },
    ValidationErrorItem: {
      type: 'object',
      required: ['field', 'message'],
      properties: {
        field: { type: 'string' },
        message: { type: 'string' },
      },
    },
    ValidationErrorResponse: {
      type: 'object',
      required: ['success', 'errors'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        errors: {
          type: 'array',
          items: { $ref: '#/components/schemas/ValidationErrorItem' },
        },
      },
    },
    IdempotencyConflictResponse: {
      type: 'object',
      required: ['error', 'message'],
      properties: {
        error: { type: 'string', example: 'Idempotency Conflict' },
        message: { type: 'string' },
      },
    },
    UserProfileResponse: {
      type: 'object',
      required: ['address', 'createdAt'],
      properties: {
        address: { type: 'string' },
        username: { type: 'string' },
        telegramHandle: { type: 'string' },
        telegramUserId: { type: 'string' },
        telegramLinked: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    CreateProfileRequest: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        username: { type: 'string' },
      },
    },
    UpdateProfileRequest: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        username: { type: 'string' },
        telegramUserId: { type: 'string' },
        telegramHandle: { type: 'string' },
      },
    },
    GameSummary: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: { type: 'integer' },
        game_type: { type: 'string' },
        bet_amount: { type: 'number' },
        result: { type: 'string' },
      },
    },
    GamesCatalogResponse: {
      type: 'object',
      required: ['games'],
      properties: {
        games: {
          type: 'array',
          items: { $ref: '#/components/schemas/GameSummary' },
        },
      },
    },
    RecentGamesResponse: {
      type: 'object',
      required: ['items', 'page', 'pageSize', 'total', 'totalPages'],
      properties: {
        items: {
          type: 'array',
          items: { $ref: '#/components/schemas/GameSummary' },
        },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        total: { type: 'integer' },
        totalPages: { type: 'integer' },
      },
    },
    IndexedGameResponse: {
      type: 'object',
      required: ['contract_id', 'chain_game_id', 'game_type', 'status', 'result'],
      properties: {
        id: { type: 'integer' },
        user_id: { type: 'integer', nullable: true },
        game_type: { type: 'string' },
        bet_amount: {
          type: 'string',
          description: 'Wager in XLM units with 7 decimals (stroops / 10^7).',
        },
        payout: {
          type: 'string',
          description: 'Payout in XLM units with 7 decimals; 0.0000000 while pending.',
        },
        result: { type: 'string', enum: ['win', 'loss', 'pending'] },
        status: { type: 'string', enum: ['pending', 'resolved'] },
        contract_id: { type: 'string' },
        chain_game_id: { type: 'string', description: 'On-chain u64 game id, decimal string.' },
        player_address: { type: 'string' },
        side: { type: 'string', enum: ['heads', 'tails'] },
        ledger: { type: 'integer', nullable: true },
        tx_hash: { type: 'string', nullable: true, description: 'Bet-placing transaction hash.' },
        resolve_tx_hash: {
          type: 'string',
          nullable: true,
          description: 'Resolving transaction hash.',
        },
        resolved_at: { type: 'string', format: 'date-time', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
    MonetaryAmountRequest: {
      type: 'object',
      required: ['amount'],
      properties: {
        amount: {
          type: 'number',
          exclusiveMinimum: 0,
        },
      },
    },
    DepositRequest: {
      allOf: [
        { $ref: '#/components/schemas/MonetaryAmountRequest' },
        {
          type: 'object',
          properties: {
            asset: { type: 'string' },
          },
        },
      ],
    },
    DepositResponse: {
      type: 'object',
      required: ['depositAddress'],
      properties: {
        depositAddress: { type: 'string' },
      },
    },
    WithdrawRequest: {
      allOf: [
        { $ref: '#/components/schemas/MonetaryAmountRequest' },
        {
          type: 'object',
          properties: {
            destination: { type: 'string' },
          },
        },
      ],
    },
    WithdrawResponse: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string' },
      },
    },
    HealthResponse: {
      type: 'object',
      required: ['status', 'timestamp', 'service'],
      properties: {
        status: { type: 'string', example: 'Operational' },
        timestamp: { type: 'string', format: 'date-time' },
        service: { type: 'string', example: 'stellarcade-api' },
      },
    },
  },
  parameters: {
    IdempotencyKeyHeader: {
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      schema: { type: 'string' },
      description: 'Client supplied key used to safely retry mutation requests.',
    },
  },
};

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function normalizePath(prefix, routePath) {
  const joined = `${prefix}${routePath === '/' ? '' : routePath}`.replace(/\/+/g, '/');
  return joined.startsWith('/api') ? joined : `/api${joined}`;
}

function extractLiteral(source, regex, description, filePath) {
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Could not find ${description} in ${path.relative(backendRoot, filePath)}`);
  }

  return match[1];
}

function evaluateLiteral(literal, filePath) {
  return vm.runInNewContext(`(${literal})`, {}, { filename: filePath });
}

function parseMounts() {
  const source = readFile(routesIndexFile);
  const variableToFile = new Map();
  let requireMatch;
  requireRegex.lastIndex = 0;

  while ((requireMatch = requireRegex.exec(source)) !== null) {
    const [, variableName, importPath] = requireMatch;
    if (importPath.startsWith('./')) {
      variableToFile.set(variableName, path.join(routesDir, `${importPath.slice(2)}.js`));
    }
  }

  const mounts = [];
  let mountMatch;
  mountRegex.lastIndex = 0;
  while ((mountMatch = mountRegex.exec(source)) !== null) {
    const [, mountPath, variableName] = mountMatch;
    const filePath = variableToFile.get(variableName);
    if (!filePath) {
      continue;
    }

    mounts.push({ mountPath, filePath });
  }

  return mounts;
}

function parseRouteDefinitions(filePath) {
  const source = readFile(filePath);
  const routeDocs = evaluateLiteral(
    extractLiteral(source, routeDocsRegex, 'routeDocs', filePath),
    filePath
  );
  const routes = [];
  let lineMatch;
  routeLineRegex.lastIndex = 0;

  while ((lineMatch = routeLineRegex.exec(source)) !== null) {
    const [, method, routePath, handlers] = lineMatch;
    routes.push({
      method,
      path: routePath,
      hasAuth: /\bauth\b/.test(handlers),
      hasIdempotency: /\bidempotency\b/.test(handlers),
      hasValidation: /\bvalidate\b/.test(handlers),
    });
  }

  return { routeDocs, routes };
}

function ensureDocCoverage(filePath, routeDocs, routes) {
  const routeKeys = new Set(routes.map((route) => `${route.method}:${route.path}`));
  const docKeys = new Set(routeDocs.map((doc) => `${doc.method}:${doc.path}`));

  for (const routeKey of routeKeys) {
    if (!docKeys.has(routeKey)) {
      throw new Error(
        `Missing OpenAPI documentation for ${routeKey} in ${path.relative(backendRoot, filePath)}`
      );
    }
  }

  for (const docKey of docKeys) {
    if (!routeKeys.has(docKey)) {
      throw new Error(
        `Stale OpenAPI documentation for ${docKey} in ${path.relative(backendRoot, filePath)}`
      );
    }
  }
}

function buildOperation(doc, route) {
  const operation = {
    operationId: doc.operationId,
    summary: doc.summary,
    tags: doc.tags,
    responses: doc.responses || { 500: defaultErrorResponse },
  };

  if (doc.description) {
    operation.description = doc.description;
  }

  if (doc.parameters) {
    operation.parameters = [...doc.parameters];
  }

  if (route.hasIdempotency) {
    operation.parameters = operation.parameters || [];
    operation.parameters.push({ $ref: '#/components/parameters/IdempotencyKeyHeader' });
  }

  if (doc.requestBody) {
    operation.requestBody = doc.requestBody;
  }

  if (route.hasAuth) {
    operation.security = [{ bearerAuth: [] }];
  }

  return operation;
}

function buildPathItem(prefix, filePath) {
  const { routeDocs, routes } = parseRouteDefinitions(filePath);
  ensureDocCoverage(filePath, routeDocs, routes);

  const routeByKey = new Map(routes.map((route) => [`${route.method}:${route.path}`, route]));
  const pathItem = {};

  for (const doc of routeDocs) {
    const route = routeByKey.get(`${doc.method}:${doc.path}`);
    const fullPath = normalizePath(prefix, doc.path);
    pathItem[fullPath] = pathItem[fullPath] || {};
    pathItem[fullPath][doc.method] = buildOperation(doc, route);
  }

  return pathItem;
}

function buildHealthPath() {
  const serverSource = readFile(serverFile);
  const healthMatch = serverSource.match(healthRouteRegex);
  if (!healthMatch) {
    const routesIndexSource = readFile(routesIndexFile);
    const routerHealthMatch = routesIndexSource.match(routerHealthRouteRegex);
    if (!routerHealthMatch) {
      throw new Error(
        'Could not find /api/health route in backend/src/server.js or backend/src/routes/index.js'
      );
    }

    return {
      [normalizePath('/api', routerHealthMatch[1])]: {
        get: {
          operationId: 'getHealthStatus',
          summary: 'Check API health',
          tags: ['Health'],
          responses: {
            200: {
              description: 'API health payload returned successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
    };
  }

  const healthPath = healthMatch[1];
  return {
    [healthPath]: {
      get: {
        operationId: 'getHealthStatus',
        summary: 'Check API health',
        tags: ['Health'],
        responses: {
          200: {
            description: 'API health payload returned successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
  };
}

function buildSpec() {
  const paths = buildHealthPath();

  for (const mount of parseMounts()) {
    Object.assign(paths, buildPathItem(mount.mountPath, mount.filePath));
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Stellarcade Backend API',
      version: '1.0.0',
      description: 'Generated OpenAPI specification for the current Express route surface.',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
    tags: [
      { name: 'Health' },
      { name: 'Auth' },
      { name: 'Games' },
      { name: 'Users' },
      { name: 'Wallet' },
      { name: 'Leaderboard' },
      { name: 'Quests' },
      { name: 'Tournaments' },
    ],
    paths,
    components,
  };
}

function formatSpec(spec) {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

function validateSpecShape(spec) {
  if (spec.openapi !== '3.0.3') {
    throw new Error(`Expected OpenAPI version 3.0.3, received ${spec.openapi}`);
  }

  const protectedRoutes = ['/api/users/audit-logs', '/api/wallet/deposit', '/api/wallet/withdraw'];

  for (const routePath of protectedRoutes) {
    const operations = spec.paths[routePath];
    if (!operations) {
      throw new Error(`Missing protected route ${routePath} in generated spec`);
    }

    for (const operation of Object.values(operations)) {
      if (!operation.security || operation.security[0]?.bearerAuth === undefined) {
        throw new Error(`Protected route ${routePath} must declare bearerAuth security`);
      }
    }
  }
}

function writeSpec() {
  const spec = buildSpec();
  validateSpecShape(spec);
  fs.writeFileSync(specFile, formatSpec(spec));
}

function validateSpec() {
  const generatedSpec = buildSpec();
  validateSpecShape(generatedSpec);

  if (!fs.existsSync(specFile)) {
    throw new Error('backend/openapi.yaml is missing. Run npm run openapi:generate.');
  }

  const checkedInSpec = evaluateLiteral(readFile(specFile), specFile);
  const checkedInContent = formatSpec(checkedInSpec);
  const generatedContent = formatSpec(generatedSpec);

  if (checkedInContent !== generatedContent) {
    throw new Error('backend/openapi.yaml is out of date. Run npm run openapi:generate.');
  }
}

function main() {
  const command = process.argv[2];

  if (command === 'generate') {
    writeSpec();
    return;
  }

  if (command === 'validate') {
    validateSpec();
    return;
  }

  throw new Error('Usage: node scripts/openapi.js <generate|validate>');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildSpec,
  formatSpec,
  validateSpec,
  writeSpec,
};
