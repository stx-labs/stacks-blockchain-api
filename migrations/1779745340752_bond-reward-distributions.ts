import { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('bond_reward_distributions', {
    bond_index: {
      type: 'integer',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    remaining_rewards: {
      type: 'numeric',
      notNull: true,
    },
    accrued_rewards: {
      type: 'numeric',
      notNull: true,
    },
    new_reserve: {
      type: 'numeric',
      notNull: true,
    },
    stx_staker_rewards: {
      type: 'numeric',
      notNull: true,
    },
    stx_cycle: {
      type: 'integer',
      notNull: true,
    },
    cycle_staked_ustx: {
      type: 'numeric',
      notNull: true,
    },
    next_rewards_per_ustx: {
      type: 'numeric',
      notNull: true,
    }
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('bond_reward_distributions');
}
