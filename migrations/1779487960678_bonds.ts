import { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('pox5_bonds', {
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
    target_rate: {
      type: 'integer',
      notNull: true,
    },
    stx_value_ratio: {
      type: 'integer',
      notNull: true,
    },
    min_ustx_ratio: {
      type: 'integer',
      notNull: true,
    },
    early_unlock_signers: {
      type: 'text',
      notNull: true,
    },
    early_unlock_admin: {
      type: 'text',
      notNull: true,
    }
  });
  pgm.createIndex(
    'pox5_bonds',
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
  pgm.createIndex('pox5_bonds', 'bond_index', {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('pox5_bonds');
};
