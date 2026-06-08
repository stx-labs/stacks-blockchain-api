import { handlePrincipalCache } from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { PrincipalSchema } from '../../schemas/v3/entities/common.js';
import {
  CursorPaginationQuerystring,
  CursorPaginatedResponse,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { PrincipalTransactionSummarySchema } from '../../schemas/v3/entities/principal-transactions.js';
import { serializePrincipalTransactionSummary } from '../../serializers/v3/transactions.js';
import { PrincipalBondPositionSchema } from '../../schemas/v3/entities/principal-bond-positions.js';
import { serializeDbPrincipalBondPosition } from '../../serializers/v3/bonds.js';
import { handleChainTipCache } from '../../controllers/cache-controller.js';

export const PrincipalsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/principals/:principal/transactions',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_transactions',
        summary: 'Get principal transactions',
        description: `Returns a list of confirmed transactions sent or received by a Stacks principal, including the transaction summary, the involvement of the principal in the transaction, and the balances affected by the transaction.`,
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(TransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            PrincipalTransactionSummarySchema,
            TransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalTransactionSummaries({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializePrincipalTransactionSummary(r)),
      });
    }
  );

  fastify.get(
    '/principals/:principal/balances/staking',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_principal_staking_balances',
        summary: 'Get principal staking balances',
        description:
          "Get a principal's staking balances: its bond positions (staked amounts and accrued rewards) across all bonds it is enrolled in",
        tags: ['Staking'],
        params: Type.Object({ principal: PrincipalSchema }),
        response: {
          200: Type.Array(PrincipalBondPositionSchema),
        },
      },
    },
    async (req, reply) => {
      const positions = await fastify.db.v3.getPrincipalStakingPositions({
        principal: req.params.principal,
      });
      await reply.send(positions.map(serializeDbPrincipalBondPosition));
    }
  );

  await Promise.resolve();
};
