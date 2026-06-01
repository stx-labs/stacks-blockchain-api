import { DbBond, DbBondSummary } from '../../../datastore/v3/types.js';
import { Bond, BondSummary } from '../../schemas/v3/entities/bonds.js';

/**
 * Serializes a database bond summary to a API bond summary.
 * @param summary - The database bond summary to serialize.
 * @returns The API bond summary.
 */
export function serializeDbBondSummary(summary: DbBondSummary): BondSummary {
  return {
    index: summary.bond_index,
    pox_version: 'pox5',
    status: 'upcoming',
    parameters: {
      target_rate_bps: summary.target_rate,
      stx_value_ratio: summary.stx_value_ratio,
      minimum_stx_ratio: summary.min_ustx_ratio,
      btc_capacity: '0',
    },
    registrations: {
      allowed_count: summary.allowed_count,
      registered_count: summary.registered_count,
    },
    schedule: {
      activation: {
        bitcoin_height: 0,
        pox_cycle: 0,
      },
      unlock: {
        bitcoin_height: 0,
        pox_cycle: 0,
      },
    },
    balances: {
      locked: {
        btc: '0',
        stx: '0',
      },
      paid_out: {
        btc: '0',
      },
    },
  };
}

/**
 * Serializes a database bond to a API bond.
 * @param bond - The database bond to serialize.
 * @returns The API bond.
 */
export function serializeDbBond(bond: DbBond): Bond {
  return {
    ...serializeDbBondSummary(bond),
    transaction: {
      tx_id: bond.tx_id,
      block: {
        height: bond.block_height,
        hash: bond.block_hash,
        index_hash: bond.index_block_hash,
        time: bond.block_time,
        tx_index: bond.tx_index,
      },
      bitcoin_block: {
        height: bond.burn_block_height,
        time: bond.burn_block_time,
      },
    },
  };
}
