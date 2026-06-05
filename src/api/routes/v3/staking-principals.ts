import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { PrincipalSchema } from '../../schemas/v3/entities/common.js';
import { PrincipalBondPositionSchema } from '../../schemas/v3/entities/principal-bond-positions.js';
import { serializeDbPrincipalBondPosition } from '../../serializers/v3/bonds.js';

export const StakingPrincipalsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/principals/:principal/positions',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_principal_staking_positions',
        summary: 'Get principal staking positions',
        description: "Get a principal's bond positions across all bonds it is enrolled in",
        tags: ['Staking'],
        params: Type.Object({
          principal: PrincipalSchema,
        }),
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
