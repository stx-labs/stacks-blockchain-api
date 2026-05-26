import { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('pox5_bond_registrations', {
    id: {
      type: 'bigserial',
      primaryKey: true,
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
    bond_index: {
      type: 'integer',
      notNull: true,
    },
    signer: {
      type: 'text',
      notNull: true,
    },
    staker: {
      type: 'text',
      notNull: true,
    },
    amount_ustx: {
      type: 'text',
      notNull: true,
    },
    sats_total: {
      type: 'text',
      notNull: true,
    },
    first_reward_cycle: {
      type: 'integer',
      notNull: true,
    },
    unlock_burn_height: {
      type: 'integer',
      notNull: true,
    },
    unlock_cycle: {
      type: 'integer',
      notNull: true,
    },
    is_l1_lock: {
      type: 'boolean',
      notNull: true,
    },
  });

  pgm.createIndex('pox5_bond_registrations', 'bond_index', {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
  });
  pgm.createIndex('pox5_bond_registrations', 'pox_address', {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
  });
  pgm.createIndex('pox5_bond_registrations', 'signer_manager', {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
  });
  pgm.createIndex(
    'pox5_bond_registrations',
    [
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    {
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('pox5_bond_registrations');
};
