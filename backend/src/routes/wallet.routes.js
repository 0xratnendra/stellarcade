const express = require('express');
const {
  getBalance,
  deposit,
  withdraw,
  WALLET_FLOW_ENABLED,
} = require('../controllers/wallet.controller');
const auth = require('../middleware/auth.middleware');
const idempotency = require('../middleware/idempotency.middleware');
const { rateLimit } = require('../middleware/rate-limit.middleware');

const { body } = require('express-validator');
const validate = require('../middleware/validation.middleware');

const router = express.Router();

/**
 * Body validation for the withdraw endpoint.
 *
 * The deposit/withdraw flow is disabled (issue #1400): both endpoints answer
 * 501 `WALLET_FLOW_DISABLED` before they look at the request body, so the
 * amount check only applies once the flow is switched back on.
 */
const amountValidation = WALLET_FLOW_ENABLED
  ? [
      body('amount')
        .isFloat({ min: 0.0000001 })
        .withMessage('Amount must be positive and greater than 0'),
    ]
  : [];

const routeDocs = [
  {
    method: 'get',
    path: '/:address/balance',
    operationId: 'getWalletBalance',
    summary: 'Fetch a wallet\'s real on-chain balances from Horizon',
    tags: ['Wallet'],
    parameters: [
      {
        name: 'address',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Stellar wallet address (G...).',
      },
    ],
    responses: {
      200: {
        description:
          'Balances returned successfully. An address that is well-formed but has never ' +
          'been funded on-chain returns a zero XLM balance rather than an error.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['address', 'balances'],
              properties: {
                address: { type: 'string' },
                balances: { type: 'object', additionalProperties: { type: 'string' } },
              },
            },
          },
        },
      },
      400: {
        description: 'The given address is not a valid Stellar public key',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
      500: {
        description: 'Unexpected server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
    },
  },
  {
    method: 'post',
    path: '/deposit',
    operationId: 'createDeposit',
    summary:
      'Create a deposit request for the authenticated user (disabled — no verified on-chain flow yet)',
    tags: ['Wallet'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/DepositRequest' },
        },
      },
    },
    responses: {
      200: {
        description: 'Deposit request accepted. Not reachable while the deposit flow is disabled.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DepositResponse' },
          },
        },
      },
      400: {
        description: 'Request payload validation failed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ValidationErrorResponse' },
          },
        },
      },
      401: {
        description: 'Authentication failed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AuthErrorResponse' },
          },
        },
      },
      409: {
        description: 'Idempotency key conflict detected',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/IdempotencyConflictResponse' },
          },
        },
      },
      500: {
        description: 'Unexpected server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
      501: {
        description:
          'The deposit flow is disabled: no verified on-chain settlement flow is wired up yet, ' +
          'so the request is refused before anything is read from or written to the database. ' +
          'The error code is WALLET_FLOW_DISABLED.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
    },
  },
  {
    method: 'post',
    path: '/withdraw',
    operationId: 'createWithdrawal',
    summary:
      'Create a withdrawal request for the authenticated user (disabled — no verified on-chain flow yet)',
    tags: ['Wallet'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/WithdrawRequest' },
        },
      },
    },
    responses: {
      200: {
        description:
          'Withdrawal request accepted. Not reachable while the withdrawal flow is disabled.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/WithdrawResponse' },
          },
        },
      },
      400: {
        description: 'Request payload validation failed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ValidationErrorResponse' },
          },
        },
      },
      401: {
        description: 'Authentication failed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AuthErrorResponse' },
          },
        },
      },
      409: {
        description: 'Idempotency key conflict detected',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/IdempotencyConflictResponse' },
          },
        },
      },
      500: {
        description: 'Unexpected server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
      501: {
        description:
          'The withdrawal flow is disabled: no verified on-chain settlement flow is wired up yet, ' +
          'so the request is refused before anything is read from or written to the database. ' +
          'The error code is WALLET_FLOW_DISABLED.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
    },
  },
];

router.get('/:address/balance', rateLimit('wallet'), getBalance);
router.post('/deposit', auth, rateLimit('wallet'), idempotency, deposit);
router.post(
  '/withdraw',
  auth,
  rateLimit('wallet'),
  idempotency,
  amountValidation,
  validate,
  withdraw
);

module.exports = router;
module.exports.routeDocs = routeDocs;
