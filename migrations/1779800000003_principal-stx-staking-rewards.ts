import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Running per-principal sBTC reward totals for pox-5 STX staking (the rewards a
 * principal earns from locking STX, as opposed to participating in a bond).
 * This is a pure materialized accumulator like `ft_balances` — one row per
 * principal, no canonical/tx-location columns — fed incrementally on write and
 * delta-corrected on reorg from the source rows in
 * `principal_stx_reward_distributions` (accruals) and the NULL-`bond_index`
 * rows of `principal_bond_reward_claims` (claims). Claimable rewards are
 * `accrued_rewards - claimed_rewards`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('principal_stx_staking_rewards', {
    principal: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    accrued_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    claimed_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_stx_staking_rewards');
}
