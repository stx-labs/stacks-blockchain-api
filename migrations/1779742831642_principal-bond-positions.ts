import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('principal_bond_positions', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    principal: {
      type: 'string',
      notNull: true,
    },
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
    status: {
      type: 'smallint',
      notNull: true,
    },
    active: {
      type: 'boolean',
      notNull: true,
    },
    btc_locked: {
      type: 'numeric',
      notNull: true,
    },
    stx_locked: {
      type: 'numeric',
      notNull: true,
    },
    btc_paid_out: {
      type: 'numeric',
      notNull: true,
    },
  });

  pgm.createIndex('principal_bond_positions', ['principal', 'bond_index'], {
    unique: true,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_bond_positions');
}
