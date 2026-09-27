import { describe, it, expect } from 'vitest';
import {
  normalizeRoutePath,
  extractExpressRoutesFromCode,
  parseOpenApiPaths,
  checkOpenApiSync,
} from './index';

describe('openapi-schema-sync', () => {
  it('normalizes Express path parameters to OpenAPI format correctly', () => {
    expect(normalizeRoutePath('/users/:id')).toBe('/users/{id}');
    expect(normalizeRoutePath('/tournaments/:tournamentId/matches/:matchId')).toBe('/tournaments/{tournamentId}/matches/{matchId}');
    expect(normalizeRoutePath('api/health/')).toBe('/api/health');
  });

  it('extracts Express routes from code accurately', () => {
    const sampleCode = `
      const router = express.Router();
      router.get('/api/v1/tournaments', listTournaments);
      router.post('/api/v1/tournaments', createTournament);
      router.get('/api/v1/tournaments/:id', getTournament);
    `;

    const routes = extractExpressRoutesFromCode(sampleCode, 'routes/tournaments.ts');
    expect(routes.length).toBe(3);
    expect(routes[0]).toEqual({ method: 'get', path: '/api/v1/tournaments', sourceFile: 'routes/tournaments.ts' });
    expect(routes[2]).toEqual({ method: 'get', path: '/api/v1/tournaments/{id}', sourceFile: 'routes/tournaments.ts' });
  });

  it('passes sync check when matching route and spec paths are provided', () => {
    const expressRoutes = [
      { method: 'get', path: '/api/v1/health' },
      { method: 'post', path: '/api/v1/login' },
    ];

    const openApiJson = JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/api/v1/health': { get: {} },
        '/api/v1/login': { post: {} },
      },
    });

    const openApiEndpoints = parseOpenApiPaths(openApiJson);
    const report = checkOpenApiSync(expressRoutes, openApiEndpoints);

    expect(report.matchedCount).toBe(2);
    expect(report.undocumentedRoutes.length).toBe(0);
    expect(report.orphanedSpecPaths.length).toBe(0);
    expect(report.hasMismatch).toBe(false);
  });

  it('detects undocumented route and flags mismatch', () => {
    const expressRoutes = [
      { method: 'get', path: '/api/v1/health' },
      { method: 'delete', path: '/api/v1/users/{id}' }, // Not in spec
    ];

    const openApiJson = JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/api/v1/health': { get: {} },
      },
    });

    const openApiEndpoints = parseOpenApiPaths(openApiJson);
    const report = checkOpenApiSync(expressRoutes, openApiEndpoints);

    expect(report.matchedCount).toBe(1);
    expect(report.undocumentedRoutes.length).toBe(1);
    expect(report.undocumentedRoutes[0].path).toBe('/api/v1/users/{id}');
    expect(report.hasMismatch).toBe(true);
  });
});
