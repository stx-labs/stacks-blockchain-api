import {
  handlePrincipalCache,
  handlePrincipalMempoolCache,
} from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { PrincipalSchema } from '../../schemas/v3/entities/common.js';
import {
  BondCursorSchema,
  CursorPaginationQuerystring,
  CursorPaginatedResponse,
  FtBalanceCursorSchema,
  NftBalanceCursorSchema,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { decodeClarityValueToRepr } from '@stacks/codec';
import { PrincipalTransactionSummarySchema } from '../../schemas/v3/entities/principal-transactions.js';
import { serializePrincipalTransactionSummary } from '../../serializers/v3/transactions.js';
import {
  PrincipalBondPositionSchema,
  PrincipalStakingSummarySchema,
} from '../../schemas/v3/entities/principal-bond-positions.js';
import {
  serializeDbPrincipalBondPosition,
  serializeDbPrincipalStakingSummary,
} from '../../serializers/v3/bonds.js';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import {
  PrincipalFtPositionSchema,
  PrincipalNftPositionSchema,
  PrincipalStxBalance,
  PrincipalStxBalanceSchema,
} from '../../schemas/v3/entities/principal-balances.js';

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
    '/principals/:principal/staking',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_principal_staking_summary',
        summary: 'Get principal staking summary',
        description:
          "A one-call overview of a principal's staking: its pox-5 STX-staking position (locked STX and its sBTC rewards) plus aggregate totals across all of its bond positions. The per-bond breakdown is paginated at `/principals/:principal/staking/bonds`.",
        tags: ['Staking'],
        params: Type.Object({ principal: PrincipalSchema }),
        response: {
          200: PrincipalStakingSummarySchema,
        },
      },
    },
    async (req, reply) => {
      const summary = await fastify.db.v3.getPrincipalStakingSummary({
        principal: req.params.principal,
      });
      await reply.send(serializeDbPrincipalStakingSummary(summary));
    }
  );

  fastify.get(
    '/principals/:principal/staking/bonds',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_principal_bond_positions',
        summary: 'Get principal bond positions',
        description:
          "Get a principal's bond positions — its enrollment, lock, status, and sBTC rewards in each bond it participates in.",
        tags: ['Staking'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(BondCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            PrincipalBondPositionSchema,
            BondCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalBondPositions({
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
        results: results.results.map(serializeDbPrincipalBondPosition),
      });
    }
  );

  fastify.get(
    '/principals/:principal/balances/stx',
    {
      preHandler: handlePrincipalMempoolCache,
      schema: {
        operationId: 'get_principal_balances_stx',
        summary: 'Get principal STX balance',
        description:
          "Get a principal's STX balance: its total and spendable (available) balance, any locked STX, and the projected balance from pending mempool transactions.",
        tags: ['Accounts'],
        params: Type.Object({ principal: PrincipalSchema }),
        response: {
          200: PrincipalStxBalanceSchema,
        },
      },
    },
    async (req, reply) => {
      const stxAddress = req.params.principal;
      const result = await fastify.db.sqlTransaction(async sql => {
        const chainTip = await fastify.db.getChainTip(sql);
        const holder = await fastify.db.v2.getStxHolderBalance({ sql, stxAddress });
        const balance = holder.found ? holder.result.balance : 0n;
        const lock = await fastify.db.v2.getStxPoxLockedAtBlock({
          sql,
          stxAddress,
          burnBlockHeight: chainTip.burn_block_height,
        });
        const mempool = await fastify.db.getPrincipalMempoolStxBalanceDelta(sql, stxAddress);

        const available = balance - lock.locked;
        const response: PrincipalStxBalance = {
          balance: balance.toString(),
          available: available.toString(),
          locked:
            lock.locked > 0n
              ? {
                  amount: lock.locked.toString(),
                  pox_version: lock.poxVersion,
                  lock_tx_id: lock.lockTxId,
                  stacks_lock_height: lock.lockHeight,
                  burn_lock_height: lock.burnchainLockHeight,
                  burn_unlock_height: lock.burnchainUnlockHeight,
                }
              : null,
          mempool:
            mempool.inbound > 0n || mempool.outbound > 0n
              ? {
                  estimated_balance: (available + mempool.delta).toString(),
                  inbound: mempool.inbound.toString(),
                  outbound: mempool.outbound.toString(),
                }
              : null,
        };
        return response;
      });
      await reply.send(result);
    }
  );

  fastify.get(
    '/principals/:principal/balances/ft',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_balances_ft',
        summary: 'Get principal FT balances',
        description: "Get a principal's fungible-token balances, sorted by balance descending.",
        tags: ['Accounts'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(FtBalanceCursorSchema, ResourceType.FtBalance),
        response: {
          200: CursorPaginatedResponse(
            PrincipalFtPositionSchema,
            FtBalanceCursorSchema,
            ResourceType.FtBalance
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalFtBalances({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.FtBalance),
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
        results: results.results.map(r => ({
          asset_identifier: r.token,
          balance: r.balance,
        })),
      });
    }
  );

  fastify.get(
    '/principals/:principal/balances/nft',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_balances_nft',
        summary: 'Get principal NFT balances',
        description:
          'Get the non-fungible token instances currently owned by a principal, ordered by asset identifier and value.',
        tags: ['Accounts'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(NftBalanceCursorSchema, ResourceType.NftBalance),
        response: {
          200: CursorPaginatedResponse(
            PrincipalNftPositionSchema,
            NftBalanceCursorSchema,
            ResourceType.NftBalance
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalNftBalances({
        principal: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.NftBalance),
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
        results: results.results.map(r => ({
          asset_identifier: r.asset_identifier,
          value: {
            hex: r.value,
            repr: decodeClarityValueToRepr(r.value),
          },
        })),
      });
    }
  );

  await Promise.resolve();
};
