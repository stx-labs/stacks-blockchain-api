import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

export const StakingBondsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/bonds',
    {
      schema: {
        operationId: 'get_bonds',
        summary: 'Get bonds',
        description: 'Get bonds',
        tags: ['Staking'],
      },
    },
    async (_req, reply) => {
      await reply.send();
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index',
    {
      schema: {
        operationId: 'get_bond',
        summary: 'Get bond',
        description: 'Get bond',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: Type.Integer({ description: 'Bond index' }),
        }),
      },
    },
    async (_req, reply) => {
      await reply.send();
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/allowlist',
    {
      schema: {
        operationId: 'get_bond_allowlist_entries',
        summary: 'Get bond allowlist entries',
        description: 'Get bond allowlist entries',
        tags: ['Staking'],
      },
    },
    async (_req, reply) => {
      await reply.send();
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/allowlist/:principal',
    {
      schema: {
        operationId: 'get_bond_allowlist_entry',
        summary: 'Get bond allowlist entry',
        description: 'Get bond allowlist entry',
        tags: ['Staking'],
      },
    },
    async (_req, reply) => {
      await reply.send();
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/registrations',
    {
      schema: {
        operationId: 'get_pox5_bond_allowlist_entries',
        summary: 'Get PoX-5 bond allowlist entries',
        description: 'Get PoX-5 bond allowlist entries',
        tags: ['PoX-5'],
      },
    },
    async (_req, reply) => {
      await reply.send();
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/registrations/:principal',
    {
      schema: {
        operationId: 'get_bond_registration',
        summary: 'Get bond registration',
        description: 'Get bond registration',
        tags: ['Staking'],
      },
    },
    async (_req, reply) => {
      await reply.send();
    }
  );

  await Promise.resolve();
};
