import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  BondCursorSchema,
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { BondSchema, BondSummarySchema } from '../../schemas/v3/entities/bonds.js';
import { BondAllowlistSchema } from '../../schemas/v3/entities/bond-allowlist-entries.js';
import {
  serializeDbBond,
  serializeDbBondAllowlistEntry,
  serializeDbBondSummary,
} from '../../serializers/v3/bonds.js';
import { NotFoundError } from '../../../errors.js';

export const StakingBondsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/bonds',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bonds',
        summary: 'Get bonds',
        description: 'Get bonds',
        tags: ['Staking'],
        querystring: CursorPaginationQuerystring(BondCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(BondSummarySchema, BondCursorSchema, ResourceType.Tx),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getBondSummaries({
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
        results: results.results.map(r => serializeDbBondSummary(r, results.burn_block_height)),
      });
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond',
        summary: 'Get bond',
        description: 'Get bond',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: Type.Integer({ description: 'Bond index' }),
        }),
        response: {
          200: BondSchema,
        },
      },
    },
    async (req, reply) => {
      const bond = await fastify.db.v3.getBond({ bondIndex: req.params.bond_index });
      if (!bond) {
        throw new NotFoundError('Bond not found');
      }
      await reply.send(serializeDbBond(bond, bond.burn_block_height));
    }
  );

  fastify.get(
    '/staking/bonds/:bond_index/allowlist',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_bond_allowlist_entries',
        summary: 'Get bond allowlist entries',
        description: 'Get bond allowlist entries',
        tags: ['Staking'],
        params: Type.Object({
          bond_index: Type.Integer({ description: 'Bond index' }),
        }),
        querystring: CursorPaginationQuerystring(TransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            BondAllowlistSchema,
            TransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getBondAllowlistEntries({
        bondIndex: req.params.bond_index,
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
        results: results.results.map(r => serializeDbBondAllowlistEntry(r)),
      });
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
