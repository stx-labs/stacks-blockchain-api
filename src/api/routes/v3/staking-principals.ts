import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { PrincipalSchema } from '../../schemas/v3/entities/common.js';

export const StakingPrincipalsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/principals/:principal/positions',
    {
      schema: {
        operationId: 'get_principal_staking_positions',
        summary: 'Get principal staking positions',
        description: 'Get principal staking positions',
        tags: ['Staking'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
      },
    },
    async (_req, reply) => {
      await reply.send();
    }
  );

  await Promise.resolve();
};
