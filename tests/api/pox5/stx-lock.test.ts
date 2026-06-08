import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { Pox5EventName } from '@stacks/codec';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';

/**
 * pox-5 stake / stake-update / unstake → materialized `stx_locked_balances`.
 * (Asserted directly against the table; the read endpoint is wired up later.)
 */

const ADMIN = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
const ALICE = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
const SIGNER = `${ADMIN}.signer-manager`;
const FIRST_REWARD_CYCLE = 8;
const UNLOCK_CYCLE = 20;

describe('pox-5 stake locked balances', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const STAKE_AMOUNT = 50_000_000n;
  const STAKE_UNLOCK = 500;
  const UPDATED_AMOUNT = 80_000_000n;
  const UPDATED_UNLOCK = 600;

  async function lockedRow(principal: string) {
    const rows = await db.sql<
      { locked_amount: string; unlock_burn_height: string; pox_version: number; lock_block_height: number }[]
    >`
      SELECT locked_amount, unlock_burn_height, pox_version, lock_block_height
      FROM stx_locked_balances WHERE principal = ${principal}
    `;
    return rows[0];
  }

  const stakeData = {
    signer: SIGNER,
    staker: ALICE,
    amount_ustx: STAKE_AMOUNT.toString(),
    num_cycles: '2',
    first_reward_cycle: String(FIRST_REWARD_CYCLE),
    unlock_burn_height: String(STAKE_UNLOCK),
    unlock_cycle: String(UNLOCK_CYCLE),
  };
  const stakeUpdateData = {
    staker: ALICE,
    signer: SIGNER,
    old_signer: SIGNER,
    prev_unlock_height: String(STAKE_UNLOCK),
    unlock_burn_height: String(UPDATED_UNLOCK),
    unlock_cycle: '25',
    num_cycles: '3',
    amount_ustx: UPDATED_AMOUNT.toString(),
    amount_increase: (UPDATED_AMOUNT - STAKE_AMOUNT).toString(),
    cycles_to_extend: '1',
  };
  const unstakeData = {
    staker: ALICE,
    signer: SIGNER,
    amount_ustx: STAKE_AMOUNT.toString(),
    first_reward_cycle: String(FIRST_REWARD_CYCLE),
    unlock_cycle: String(UNLOCK_CYCLE),
    unlock_burn_height: String(STAKE_UNLOCK),
  };

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false, skipMigrations: true });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    // Block 1: alice stakes.
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' })
        .addTx({ tx_id: '0x' + 'a1'.repeat(32) })
        .addTxPox5Event({ name: Pox5EventName.Stake, data: stakeData })
        .build()
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('stake materializes the locked balance', async () => {
    const row = await lockedRow(ALICE);
    assert.ok(row, 'locked balance row created');
    assert.equal(BigInt(row.locked_amount), STAKE_AMOUNT);
    assert.equal(BigInt(row.unlock_burn_height), BigInt(STAKE_UNLOCK));
    assert.equal(row.pox_version, 5);
    assert.equal(row.lock_block_height, 1);
  });

  test('stake-update replaces the locked balance with the new total + unlock', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: '0x' + 'a2'.repeat(32) })
        .addTxPox5Event({ name: Pox5EventName.StakeUpdate, data: stakeUpdateData })
        .build()
    );
    const row = await lockedRow(ALICE);
    assert.equal(BigInt(row.locked_amount), UPDATED_AMOUNT);
    assert.equal(BigInt(row.unlock_burn_height), BigInt(UPDATED_UNLOCK));
  });

  test('unstake clears the locked balance', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: '0x' + 'a2'.repeat(32) })
        .addTxPox5Event({ name: Pox5EventName.Unstake, data: unstakeData })
        .build()
    );
    assert.equal(await lockedRow(ALICE), undefined, 'locked balance row removed');
  });
});

/**
 * pox-4 (and earlier) `stx_lock` events emitted by transactions are inherited
 * into the same materialized `stx_locked_balances` table, with the pox version
 * derived from the lock event's `contract_name`.
 */
describe('pox-4 stx_lock inheritance', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const BOB = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
  const POX4_LOCKED = 75_000_000;
  const POX4_UNLOCK = 4200;

  async function lockedRow(principal: string) {
    const rows = await db.sql<
      {
        locked_amount: string;
        unlock_burn_height: string;
        pox_version: number;
        lock_block_height: number;
        burnchain_lock_height: string;
      }[]
    >`
      SELECT locked_amount, unlock_burn_height, pox_version, lock_block_height, burnchain_lock_height
      FROM stx_locked_balances WHERE principal = ${principal}
    `;
    return rows[0];
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false, skipMigrations: true });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('a pox-4 stx_lock event materializes the locked balance', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: '0x01',
        index_block_hash: '0x01',
        burn_block_height: 100,
      })
        .addTx({ tx_id: '0x' + 'b1'.repeat(32) })
        .addTxStxLockEvent({
          locked_address: BOB,
          locked_amount: POX4_LOCKED,
          unlock_height: POX4_UNLOCK,
          contract_name: 'pox-4',
        })
        .build()
    );
    const row = await lockedRow(BOB);
    assert.ok(row, 'locked balance row created from pox-4 lock event');
    assert.equal(BigInt(row.locked_amount), BigInt(POX4_LOCKED));
    assert.equal(BigInt(row.unlock_burn_height), BigInt(POX4_UNLOCK));
    assert.equal(row.pox_version, 4);
    assert.equal(row.lock_block_height, 1);
  });

  test('a later pox-4 lock event replaces the prior lock state', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: '0x01',
        index_block_hash: '0x01',
        burn_block_height: 100,
      })
        .addTx({ tx_id: '0x' + 'b1'.repeat(32) })
        .addTxStxLockEvent({
          locked_address: BOB,
          locked_amount: POX4_LOCKED,
          unlock_height: POX4_UNLOCK,
          contract_name: 'pox-4',
        })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
        burn_block_height: 101,
      })
        .addTx({ tx_id: '0x' + 'b2'.repeat(32) })
        .addTxStxLockEvent({
          locked_address: BOB,
          locked_amount: 90_000_000,
          unlock_height: 5000,
          contract_name: 'pox-4',
        })
        .build()
    );
    const row = await lockedRow(BOB);
    assert.equal(BigInt(row.locked_amount), 90_000_000n);
    assert.equal(BigInt(row.unlock_burn_height), 5000n);
    assert.equal(row.lock_block_height, 2);
  });
});

/**
 * Reorg handling for the materialized `stx_locked_balances` table. Because the
 * locked balance is a SET/latest-wins value (not additive), reorgs are handled
 * by recomputing each affected principal's latest canonical lock — not by
 * applying deltas. A lock on an orphaned fork must disappear (reverting to the
 * prior canonical lock, if any), and reappear if its fork is restored.
 */
describe('stx_locked_balances reorg handling', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const ALICE = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
  const SIGNER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

  function stakeData(amount: bigint, unlock: number) {
    return {
      signer: SIGNER,
      staker: ALICE,
      amount_ustx: amount.toString(),
      num_cycles: '2',
      first_reward_cycle: '8',
      unlock_burn_height: String(unlock),
      unlock_cycle: '20',
    };
  }

  async function lockedRow(principal: string) {
    const rows = await db.sql<
      { locked_amount: string; unlock_burn_height: string; pox_version: number; lock_block_height: number }[]
    >`
      SELECT locked_amount, unlock_burn_height, pox_version, lock_block_height
      FROM stx_locked_balances WHERE principal = ${principal}
    `;
    return rows[0];
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false, skipMigrations: true });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    // Genesis.
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' }).build()
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('a pox-5 stake on an orphaned fork disappears and is restored when its fork wins again', async () => {
    // Fork A, block 2: alice stakes.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xa2',
        index_block_hash: '0xa2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: '0x' + 'a2'.repeat(32) })
        .addTxPox5Event({ name: Pox5EventName.Stake, data: stakeData(50_000_000n, 500) })
        .build()
    );
    assert.ok(await lockedRow(ALICE), 'lock present on fork A');

    // Fork B (blocks 2 + 3, no stake) overtakes fork A.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xb2',
        index_block_hash: '0xb2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: '0x' + 'b2'.repeat(32) })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0xb2',
        parent_index_block_hash: '0xb2',
      })
        .addTx({ tx_id: '0x' + 'b3'.repeat(32) })
        .build()
    );
    assert.equal(await lockedRow(ALICE), undefined, 'lock gone after fork A orphaned');

    // Fork A (blocks 3 + 4) wins again.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xa3',
        index_block_hash: '0xa3',
        parent_block_hash: '0xa2',
        parent_index_block_hash: '0xa2',
      })
        .addTx({ tx_id: '0x' + 'a3'.repeat(32) })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        block_hash: '0xa4',
        index_block_hash: '0xa4',
        parent_block_hash: '0xa3',
        parent_index_block_hash: '0xa3',
      })
        .addTx({ tx_id: '0x' + 'a4'.repeat(32) })
        .build()
    );
    const restored = await lockedRow(ALICE);
    assert.ok(restored, 'lock restored when fork A wins again');
    assert.equal(BigInt(restored.locked_amount), 50_000_000n);
    assert.equal(restored.pox_version, 5);
  });

  test('orphaning a pox-5 stake reverts to the principal prior pox-4 lock', async () => {
    // Block 2 (canonical chain): a pox-4 lock for alice.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
        burn_block_height: 200,
      })
        .addTx({ tx_id: '0x' + 'c2'.repeat(32) })
        .addTxStxLockEvent({
          locked_address: ALICE,
          locked_amount: 30_000_000,
          unlock_height: 9000,
          contract_name: 'pox-4',
        })
        .build()
    );
    // Fork A, block 3: a pox-5 stake supersedes the pox-4 lock.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xa3',
        index_block_hash: '0xa3',
        parent_block_hash: '0x02',
        parent_index_block_hash: '0x02',
      })
        .addTx({ tx_id: '0x' + 'a3'.repeat(32) })
        .addTxPox5Event({ name: Pox5EventName.Stake, data: stakeData(50_000_000n, 500) })
        .build()
    );
    let row = await lockedRow(ALICE);
    assert.equal(row.pox_version, 5, 'pox-5 stake is the latest lock');
    assert.equal(BigInt(row.locked_amount), 50_000_000n);

    // Fork B (blocks 3 + 4, no stake) overtakes fork A, orphaning the pox-5 stake.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0x02',
        parent_index_block_hash: '0x02',
      })
        .addTx({ tx_id: '0x' + 'd3'.repeat(32) })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        block_hash: '0xb4',
        index_block_hash: '0xb4',
        parent_block_hash: '0xb3',
        parent_index_block_hash: '0xb3',
      })
        .addTx({ tx_id: '0x' + 'd4'.repeat(32) })
        .build()
    );
    row = await lockedRow(ALICE);
    assert.ok(row, 'lock still present (reverted to pox-4)');
    assert.equal(row.pox_version, 4, 'reverted to the pox-4 lock');
    assert.equal(BigInt(row.locked_amount), 30_000_000n);
  });
});
