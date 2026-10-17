const { buildSpec, formatSpec } = require('../../scripts/openapi');

describe('OpenAPI generation', () => {
  test('documents the current backend route surface', () => {
    const spec = buildSpec();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/health'].get.operationId).toBe('getHealthStatus');
    expect(spec.paths['/api/games/play']).toBeUndefined();
    expect(spec.paths['/api/users/profile'].get.security).toBeUndefined();
    expect(spec.paths['/api/users/audit-logs'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths['/api/wallet/deposit'].post.parameters).toContainEqual({
      $ref: '#/components/parameters/IdempotencyKeyHeader',
    });
    expect(
      spec.paths['/api/wallet/withdraw'].post.responses[400].content['application/json'].schema
    ).toEqual({
      $ref: '#/components/schemas/ValidationErrorResponse',
    });
  });

  test('serializes the generated spec deterministically', () => {
    const spec = buildSpec();
    const formatted = formatSpec(spec);

    expect(formatted).toContain('"openapi": "3.0.3"');
    expect(formatted).toContain('"/api/games/recent"');
  });
});
