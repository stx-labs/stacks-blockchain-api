import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  SignerCursorSchema,
} from '../../schemas/v3/cursors.js';
import { StakingSignerSchema } from '../../schemas/v3/entities/staking-signers.js';

export const StakingSignersRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/signers',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_staking_signers',
        summary: 'Get staking signers',
        description: 'Get the registered pox-5 staking signers and their current signing keys.',
        tags: ['Staking'],
        querystring: CursorPaginationQuerystring(SignerCursorSchema, ResourceType.Signer),
        response: {
          200: CursorPaginatedResponse(
            StakingSignerSchema,
            SignerCursorSchema,
            ResourceType.Signer
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getStakingSigners({
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Signer),
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
        results: results.results,
      });
    }
  );

  await Promise.resolve();
};
