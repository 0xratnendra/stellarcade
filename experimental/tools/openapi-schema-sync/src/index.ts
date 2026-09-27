import fs from 'fs';
import path from 'path';

export interface RouteEndpoint {
  method: string;
  path: string;
  sourceFile?: string;
}

export interface SyncReport {
  matchedCount: number;
  undocumentedRoutes: RouteEndpoint[];
  orphanedSpecPaths: RouteEndpoint[];
  hasMismatch: boolean;
}

export function normalizeRoutePath(routePath: string): string {
  // Convert Express style parameters like /users/:id/posts/:postId to OpenAPI style /users/{id}/posts/{postId}
  let normalized = routePath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
  // Ensure leading slash and trim trailing slash (unless root /)
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function extractExpressRoutesFromCode(code: string, sourceFile = ''): RouteEndpoint[] {
  const routes: RouteEndpoint[] = [];
  // Match router.get('/path', ...), app.post('/path', ...), router.route('/path').get(...)
  const routeRegex = /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  let match;
  while ((match = routeRegex.exec(code)) !== null) {
    const method = match[1].toLowerCase();
    const rawPath = match[2];
    routes.push({
      method,
      path: normalizeRoutePath(rawPath),
      sourceFile,
    });
  }

  return routes;
}

export function parseOpenApiPaths(specContent: string): RouteEndpoint[] {
  const endpoints: RouteEndpoint[] = [];
  let spec: any;

  try {
    spec = JSON.parse(specContent);
  } catch {
    // If not JSON, try simple regex matching for YAML paths/methods
    const yamlPathRegex = /^\s{2}\/([^:\n\r]+):/gm;
    let pathMatch;
    while ((pathMatch = yamlPathRegex.exec(specContent)) !== null) {
      const rawPath = '/' + pathMatch[1].trim();
      const normPath = normalizeRoutePath(rawPath);

      // Find HTTP methods under this path
      const pathBlock = specContent.slice(pathMatch.index);
      const methodMatches = pathBlock.matchAll(/^\s{4}(get|post|put|delete|patch):/gm);
      for (const m of methodMatches) {
        endpoints.push({
          method: m[1].toLowerCase(),
          path: normPath,
        });
      }
    }
    return endpoints;
  }

  if (spec && spec.paths) {
    for (const [pathStr, pathObj] of Object.entries(spec.paths)) {
      if (pathObj && typeof pathObj === 'object') {
        const normPath = normalizeRoutePath(pathStr);
        for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
          if ((pathObj as any)[method]) {
            endpoints.push({
              method,
              path: normPath,
            });
          }
        }
      }
    }
  }

  return endpoints;
}

export function checkOpenApiSync(expressRoutes: RouteEndpoint[], openApiEndpoints: RouteEndpoint[]): SyncReport {
  const specKeySet = new Set(openApiEndpoints.map((e) => `${e.method.toUpperCase()} ${e.path}`));
  const routeKeySet = new Set(expressRoutes.map((e) => `${e.method.toUpperCase()} ${e.path}`));

  const undocumentedRoutes: RouteEndpoint[] = [];
  const orphanedSpecPaths: RouteEndpoint[] = [];
  let matchedCount = 0;

  for (const route of expressRoutes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (specKeySet.has(key)) {
      matchedCount++;
    } else {
      undocumentedRoutes.push(route);
    }
  }

  for (const endpoint of openApiEndpoints) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    if (!routeKeySet.has(key)) {
      orphanedSpecPaths.push(endpoint);
    }
  }

  const hasMismatch = undocumentedRoutes.length > 0 || orphanedSpecPaths.length > 0;

  return {
    matchedCount,
    undocumentedRoutes,
    orphanedSpecPaths,
    hasMismatch,
  };
}

export function scanAndCheckSync(routesDir: string, specPath: string): SyncReport {
  const expressRoutes: RouteEndpoint[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(js|ts|jsx|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        expressRoutes.push(...extractExpressRoutesFromCode(content, fullPath));
      }
    }
  }

  walk(routesDir);
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const specEndpoints = parseOpenApiPaths(specContent);

  return checkOpenApiSync(expressRoutes, specEndpoints);
}

// Minimal CLI runner
if (require.main === module) {
  const args = process.argv.slice(2);
  let routesDir = '';
  let specPath = '';
  let failOnMissing = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--routes-dir') routesDir = args[++i];
    else if (args[i] === '--spec') specPath = args[++i];
    else if (args[i] === '--fail-on-missing') failOnMissing = true;
  }

  if (!routesDir || !specPath) {
    console.error('Usage: openapi-schema-sync --routes-dir <path> --spec <openapi.yaml> [--fail-on-missing]');
    process.exit(1);
  }

  try {
    const report = scanAndCheckSync(routesDir, specPath);
    console.log(`Matched Endpoints: ${report.matchedCount}`);
    console.log(`Undocumented Routes: ${report.undocumentedRoutes.length}`);
    console.log(`Orphaned Spec Paths: ${report.orphanedSpecPaths.length}`);

    if (report.undocumentedRoutes.length > 0) {
      console.log('\n[Undocumented Endpoints]');
      report.undocumentedRoutes.forEach((r) => console.log(`  - ${r.method.toUpperCase()} ${r.path} (${r.sourceFile})`));
    }

    if (failOnMissing && report.hasMismatch) {
      console.error('\nSync check failed: API route and OpenAPI spec mismatch detected.');
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
