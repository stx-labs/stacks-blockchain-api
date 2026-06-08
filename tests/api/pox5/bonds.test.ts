import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { Pox5EventName } from '@stacks/codec';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';

/**
 * pox-5 bonds — simulated ingestion tests.
 *
 * Unlike `tests/pox5/bonds.test.ts` (a full end-to-end suite against a live
 * dockerized chain), this suite builds blocks with `TestBlockBuilder`, attaches
 * synthetic pox-5 events (setup-bond / add-to-allowlist / register-for-bond),
 * ingests them via `db.update()`, and asserts the resulting API state — no
 * blockchain, miners, or sidecars required. It mirrors the same checks: the
 * pox5_events table, the bond summary/detail, allowlist, and registration
 * endpoints.
 */

// Principals (reused from the e2e suite for parity).
const ADMIN = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
const ALICE = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
const BOB = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';
const SIGNER = `${ADMIN}.signer-manager`;

const SETUP_TX_ID = '0x' + '11'.repeat(32);
const REGISTER_TX_ID = '0x' + '22'.repeat(32);

// Bond parameters (mirror the e2e / stacks-core scenario).
const BOND_INDEX = 0;
const TARGET_RATE_BPS = 300;
const STX_VALUE_RATIO = 10_000_000;
const MIN_USTX_RATIO = 1_000;
const ALICE_MAX_SATS = 100_000_000n;
const BOB_MAX_SATS = 5_000_000n;
const EXPECTED_BTC_CAPACITY = ALICE_MAX_SATS + BOB_MAX_SATS; // summed from the allowlist

// Registration parameters.
const AMOUNT_USTX = 10_000_000n;
const SBTC_SATS = 1_000n;
const FIRST_REWARD_CYCLE = 8;
const UNLOCK_BURN_HEIGHT = 410;
const UNLOCK_CYCLE = 20;
const BOND_START_HEIGHT = 160;

const SETUP_BOND_DATA = {
  bond_index: String(BOND_INDEX),
  target_rate: String(TARGET_RATE_BPS),
  stx_value_ratio: String(STX_VALUE_RATIO),
  min_ustx_ratio: String(MIN_USTX_RATIO),
  early_unlock_bytes: '',
  early_unlock_admin: ADMIN,
  first_reward_cycle: String(FIRST_REWARD_CYCLE),
  bond_start_height: String(BOND_START_HEIGHT),
  unlock_cycle: String(UNLOCK_CYCLE),
  unlock_burn_height: String(UNLOCK_BURN_HEIGHT),
};

interface BondSummaryItem {
  index: number;
  pox_version: string;
  parameters: {
    target_rate_bps: number;
    stx_value_ratio: number;
    minimum_stx_ratio: number;
    btc_capacity: string;
  };
  registrations: { allowed_count: number; registered_count: number };
  balances: { locked: { btc: string; stx: string }; paid_out: { btc: string } };
}
interface BondDetail extends BondSummaryItem {
  transaction: { tx_id: string };
}
interface BondAllowlistEntry {
  staker: string;
  max_sats: string;
}
interface BondRegistration {
  bond_index: number;
  signer: string;
  staker: string;
  amount_ustx: string;
  sats_total: string;
  is_l1_lock: boolean;
}
interface CursorPaginated<T> {
  total: number;
  results: T[];
}
interface PrincipalBondPositionItem {
  bond_index: number;
  status: string;
  active: boolean;
  balances: { locked: { btc: string; stx: string }; paid_out: { btc: string } };
  enrollment: { tx_id: string; btc_lockup: { amount: string } };
  amount: string;
  accrued_rewards: string;
}

const normalizeTxId = (txid: string) => txid.replace(/^0x/, '').toLowerCase();

describe('pox-5 bonds (simulated ingestion)', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  /** GET a JSON endpoint, asserting a 200 response. */
  async function getJson<T>(path: string): Promise<T> {
    const res = await supertest(api.server).get(path);
    assert.equal(res.status, 200, `GET ${path} -> ${res.status}: ${res.text}`);
    assert.equal(res.type, 'application/json');
    return JSON.parse(res.text) as T;
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    // Build one block: a setup-bond tx (SetupBond + two AddToAllowlist events)
    // and a register-for-bond tx (RegisterForBond event), then ingest it.
    const block = new TestBlockBuilder({ block_height: 1, index_block_hash: '0xb1' })
      .addTx({ tx_id: SETUP_TX_ID })
      .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
      .addTxPox5Event({
        name: Pox5EventName.AddToAllowlist,
        data: { bond_index: String(BOND_INDEX), staker: ALICE, max_sats: ALICE_MAX_SATS.toString() },
      })
      .addTxPox5Event({
        name: Pox5EventName.AddToAllowlist,
        data: { bond_index: String(BOND_INDEX), staker: BOB, max_sats: BOB_MAX_SATS.toString() },
      })
      .addTx({ tx_id: REGISTER_TX_ID })
      .addTxPox5Event({
        name: Pox5EventName.RegisterForBond,
        data: {
          bond_index: String(BOND_INDEX),
          signer: SIGNER,
          staker: ALICE,
          amount_ustx: AMOUNT_USTX.toString(),
          sats_total: SBTC_SATS.toString(),
          first_reward_cycle: String(FIRST_REWARD_CYCLE),
          unlock_burn_height: String(UNLOCK_BURN_HEIGHT),
          unlock_cycle: String(UNLOCK_CYCLE),
          is_l1_lock: false,
        },
      })
      .build();
    await db.update(block);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('the pox-5 events are ingested into pox5_events', async () => {
    const rows = await db.sql<{ name: string }[]>`
      SELECT name FROM pox5_events WHERE canonical = TRUE ORDER BY id ASC
    `;
    const names = rows.map(r => r.name);
    assert.ok(names.includes(Pox5EventName.SetupBond), 'setup-bond event recorded');
    assert.equal(
      names.filter(n => n === Pox5EventName.AddToAllowlist).length,
      2,
      'two add-to-allowlist events recorded'
    );
    assert.ok(names.includes(Pox5EventName.RegisterForBond), 'register-for-bond event recorded');
  });

  test('the bond appears in GET /extended/v3/staking/bonds', async () => {
    const list = await getJson<CursorPaginated<BondSummaryItem>>(
      '/extended/v3/staking/bonds?limit=50'
    );
    const bond = list.results.find(b => b.index === BOND_INDEX);
    assert.ok(bond, `bond #${BOND_INDEX} present in list`);
    assert.equal(bond.pox_version, 'pox5');
    assert.equal(bond.parameters.target_rate_bps, TARGET_RATE_BPS);
    assert.equal(bond.parameters.stx_value_ratio, STX_VALUE_RATIO);
    assert.equal(bond.parameters.minimum_stx_ratio, MIN_USTX_RATIO);
    // btc_capacity is summed from the allowlist entries' max-sats.
    assert.equal(BigInt(bond.parameters.btc_capacity), EXPECTED_BTC_CAPACITY);
    assert.equal(bond.registrations.allowed_count, 2);
  });

  test('the bond appears in GET /extended/v3/staking/bonds/:index', async () => {
    const bond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_INDEX}`);
    assert.equal(bond.index, BOND_INDEX);
    assert.equal(bond.pox_version, 'pox5');
    assert.equal(bond.parameters.target_rate_bps, TARGET_RATE_BPS);
    assert.equal(BigInt(bond.parameters.btc_capacity), EXPECTED_BTC_CAPACITY);
    // Links back to the setup-bond transaction.
    assert.equal(normalizeTxId(bond.transaction.tx_id), normalizeTxId(SETUP_TX_ID));
  });

  test('the allowlist lists alice and bob (GET .../allowlist)', async () => {
    const list = await getJson<CursorPaginated<BondAllowlistEntry>>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/allowlist?limit=50`
    );
    const aliceEntry = list.results.find(e => e.staker === ALICE);
    const bobEntry = list.results.find(e => e.staker === BOB);
    assert.ok(aliceEntry, 'alice present in allowlist');
    assert.ok(bobEntry, 'bob present in allowlist');
    assert.equal(BigInt(aliceEntry.max_sats), ALICE_MAX_SATS);
    assert.equal(BigInt(bobEntry.max_sats), BOB_MAX_SATS);
  });

  test('alice appears in GET .../allowlist/:principal', async () => {
    const entry = await getJson<BondAllowlistEntry>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/allowlist/${ALICE}`
    );
    assert.equal(entry.staker, ALICE);
    assert.equal(BigInt(entry.max_sats), ALICE_MAX_SATS);
  });

  test("alice's registration appears in GET .../registrations", async () => {
    const list = await getJson<CursorPaginated<BondRegistration>>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations?limit=50`
    );
    const reg = list.results.find(r => r.staker === ALICE);
    assert.ok(reg, 'alice present in registrations');
    assert.equal(reg.bond_index, BOND_INDEX);
    assert.equal(reg.signer, SIGNER);
    assert.equal(BigInt(reg.amount_ustx), AMOUNT_USTX);
    assert.equal(BigInt(reg.sats_total), SBTC_SATS);
    assert.equal(reg.is_l1_lock, false);
  });

  test('alice appears in GET .../registrations/:principal', async () => {
    const reg = await getJson<BondRegistration>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations/${ALICE}`
    );
    assert.equal(reg.staker, ALICE);
    assert.equal(reg.bond_index, BOND_INDEX);
    assert.equal(BigInt(reg.amount_ustx), AMOUNT_USTX);
    assert.equal(reg.is_l1_lock, false);
  });

  test("alice's position appears in GET .../principals/:principal/balances/staking", async () => {
    const positions = await getJson<PrincipalBondPositionItem[]>(
      `/extended/v3/principals/${ALICE}/balances/staking`
    );
    const pos = positions.find(p => p.bond_index === BOND_INDEX);
    assert.ok(pos, `alice has a position for bond #${BOND_INDEX}`);
    assert.equal(pos.status, 'enrolled');
    assert.equal(pos.active, true);
    // locked STX = registered amount_ustx; locked BTC = registered sats_total.
    assert.equal(BigInt(pos.balances.locked.stx), AMOUNT_USTX);
    assert.equal(BigInt(pos.balances.locked.btc), SBTC_SATS);
    assert.equal(BigInt(pos.balances.paid_out.btc), 0n);
    assert.equal(BigInt(pos.amount), AMOUNT_USTX);
    assert.equal(BigInt(pos.enrollment.btc_lockup.amount), SBTC_SATS);
    // The position links back to the register-for-bond transaction.
    assert.equal(normalizeTxId(pos.enrollment.tx_id), normalizeTxId(REGISTER_TX_ID));
  });
});

/**
 * The same bond surfaces, but driven across MULTIPLE blocks to exercise
 * cross-block state accumulation and the update-bond-registration path:
 *   block 1: setup-bond + allowlist
 *   block 2: alice register-for-bond
 *   block 3: alice update-bond-registration (new signer + amounts)
 */
describe('pox-5 bonds lifecycle (multi-block)', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  // Updated registration values applied in block 3.
  const NEW_SIGNER = `${ADMIN}.signer-manager-2`;
  const UPDATED_AMOUNT_USTX = 20_000_000n;
  const UPDATED_SATS = 2_000n;

  async function getJson<T>(path: string): Promise<T> {
    const res = await supertest(api.server).get(path);
    assert.equal(res.status, 200, `GET ${path} -> ${res.status}: ${res.text}`);
    return JSON.parse(res.text) as T;
  }

  async function getRegistration(): Promise<BondRegistration> {
    return getJson<BondRegistration>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations/${ALICE}`
    );
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('a bond progresses setup -> register -> update across blocks', async () => {
    // --- Block 1: setup-bond + allowlist ---
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0xc101', index_block_hash: '0xc1' })
        .addTx({ tx_id: SETUP_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: {
            bond_index: String(BOND_INDEX),
            staker: ALICE,
            max_sats: ALICE_MAX_SATS.toString(),
          },
        })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: { bond_index: String(BOND_INDEX), staker: BOB, max_sats: BOB_MAX_SATS.toString() },
        })
        .build()
    );

    const bond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_INDEX}`);
    assert.equal(bond.index, BOND_INDEX);
    assert.equal(BigInt(bond.parameters.btc_capacity), EXPECTED_BTC_CAPACITY);
    const noRegs = await getJson<CursorPaginated<BondRegistration>>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations?limit=50`
    );
    assert.equal(noRegs.results.length, 0, 'no registrations before block 2');

    // --- Block 2: alice register-for-bond ---
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xc102',
        index_block_hash: '0xc2',
        parent_block_hash: '0xc101',
        parent_index_block_hash: '0xc1',
      })
        .addTx({ tx_id: REGISTER_TX_ID })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: {
            bond_index: String(BOND_INDEX),
            signer: SIGNER,
            staker: ALICE,
            amount_ustx: AMOUNT_USTX.toString(),
            sats_total: SBTC_SATS.toString(),
            first_reward_cycle: String(FIRST_REWARD_CYCLE),
            unlock_burn_height: String(UNLOCK_BURN_HEIGHT),
            unlock_cycle: String(UNLOCK_CYCLE),
            is_l1_lock: false,
          },
        })
        .build()
    );

    const reg = await getRegistration();
    assert.equal(reg.signer, SIGNER);
    assert.equal(BigInt(reg.amount_ustx), AMOUNT_USTX);
    assert.equal(BigInt(reg.sats_total), SBTC_SATS);

    // --- Block 3: alice update-bond-registration ---
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xc103',
        index_block_hash: '0xc3',
        parent_block_hash: '0xc102',
        parent_index_block_hash: '0xc2',
      })
        .addTx({ tx_id: '0x' + '33'.repeat(32) })
        .addTxPox5Event({
          name: Pox5EventName.UpdateBondRegistration,
          // The update branch reads `amount_sats` (not `sats_total`).
          data: {
            bond_index: String(BOND_INDEX),
            signer: NEW_SIGNER,
            staker: ALICE,
            amount_ustx: UPDATED_AMOUNT_USTX.toString(),
            amount_sats: UPDATED_SATS.toString(),
          },
        })
        .build()
    );

    const updated = await getRegistration();
    assert.equal(updated.signer, NEW_SIGNER, 'signer updated');
    assert.equal(BigInt(updated.amount_ustx), UPDATED_AMOUNT_USTX, 'amount_ustx updated');
    assert.equal(BigInt(updated.sats_total), UPDATED_SATS, 'sats_total updated');
    // Still a single registration for alice (update, not a new row).
    const regs = await getJson<CursorPaginated<BondRegistration>>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations?limit=50`
    );
    assert.equal(regs.results.filter(r => r.staker === ALICE).length, 1);
  });
});

/**
 * Reorg handling: a bond ingested on one fork must disappear from the
 * canonical-filtered endpoints when that fork is orphaned, and reappear if the
 * fork is later restored as canonical.
 */
describe('pox-5 bonds reorg handling', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  async function getJson<T>(path: string): Promise<T> {
    const res = await supertest(api.server).get(path);
    assert.equal(res.status, 200, `GET ${path} -> ${res.status}: ${res.text}`);
    return JSON.parse(res.text) as T;
  }
  async function getStatus(path: string): Promise<number> {
    return (await supertest(api.server).get(path)).status;
  }
  async function bondExists(): Promise<boolean> {
    return (await getStatus(`/extended/v3/staking/bonds/${BOND_INDEX}`)) === 200;
  }
  async function canonicalBondEventCount(): Promise<number> {
    const rows = await db.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM pox5_events WHERE canonical = TRUE
    `;
    return rows[0].count;
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('an orphaned bond disappears, and is restored when its fork wins again', async () => {
    // Genesis.
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' }).build()
    );

    // Fork A, block 2: the full bond (setup + allowlist + register).
    const blockA = new TestBlockBuilder({
      block_height: 2,
      block_hash: '0xa2',
      index_block_hash: '0xa2',
      parent_block_hash: '0x01',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: SETUP_TX_ID })
      .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
      .addTxPox5Event({
        name: Pox5EventName.AddToAllowlist,
        data: { bond_index: String(BOND_INDEX), staker: ALICE, max_sats: ALICE_MAX_SATS.toString() },
      })
      .addTxPox5Event({
        name: Pox5EventName.AddToAllowlist,
        data: { bond_index: String(BOND_INDEX), staker: BOB, max_sats: BOB_MAX_SATS.toString() },
      })
      .addTx({ tx_id: REGISTER_TX_ID })
      .addTxPox5Event({
        name: Pox5EventName.RegisterForBond,
        data: {
          bond_index: String(BOND_INDEX),
          signer: SIGNER,
          staker: ALICE,
          amount_ustx: AMOUNT_USTX.toString(),
          sats_total: SBTC_SATS.toString(),
          first_reward_cycle: String(FIRST_REWARD_CYCLE),
          unlock_burn_height: String(UNLOCK_BURN_HEIGHT),
          unlock_cycle: String(UNLOCK_CYCLE),
          is_l1_lock: false,
        },
      })
      .build();
    await db.update(blockA);

    // Bond + registration + position are all visible on the canonical chain.
    assert.equal(await bondExists(), true, 'bond visible on fork A');
    assert.ok((await canonicalBondEventCount()) > 0, 'pox5_events canonical on fork A');
    const regs = await getJson<CursorPaginated<BondRegistration>>(`/extended/v3/staking/bonds/${BOND_INDEX}/registrations?limit=50`);
    assert.equal(regs.results.length, 1, 'registration visible on fork A');
    const positions = await getJson<PrincipalBondPositionItem[]>(`/extended/v3/principals/${ALICE}/balances/staking`);
    assert.equal(positions.length, 1, 'position visible on fork A');

    // Fork B overtakes fork A (height 2 then 3) — no bond on this fork.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xb2',
        index_block_hash: '0xb2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0xb2',
        parent_index_block_hash: '0xb2',
      }).build()
    );

    // Fork A (with the bond) is now orphaned — everything must be gone.
    assert.equal(await bondExists(), false, 'bond gone after reorg');
    assert.equal(await getStatus(`/extended/v3/staking/bonds/${BOND_INDEX}`), 404);
    assert.equal(await canonicalBondEventCount(), 0, 'pox5_events flipped non-canonical');
    const regsAfter = await getJson<CursorPaginated<BondRegistration>>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations?limit=50`
    );
    assert.equal(regsAfter.results.length, 0, 'registration gone after reorg');
    const positionsAfter = await getJson<PrincipalBondPositionItem[]>(`/extended/v3/principals/${ALICE}/balances/staking`);
    assert.equal(positionsAfter.length, 0, 'position gone after reorg');

    // Fork A wins again (extends to height 4) — the bond is restored.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xa3',
        index_block_hash: '0xa3',
        parent_block_hash: '0xa2',
        parent_index_block_hash: '0xa2',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        block_hash: '0xa4',
        index_block_hash: '0xa4',
        parent_block_hash: '0xa3',
        parent_index_block_hash: '0xa3',
      }).build()
    );

    assert.equal(await bondExists(), true, 'bond restored after fork A wins again');
    assert.ok((await canonicalBondEventCount()) > 0, 'pox5_events canonical again');
    const regsRestored = await getJson<CursorPaginated<BondRegistration>>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations?limit=50`
    );
    assert.equal(regsRestored.results.length, 1, 'registration restored');
    const positionsRestored = await getJson<PrincipalBondPositionItem[]>(
      `/extended/v3/principals/${ALICE}/balances/staking`
    );
    assert.equal(positionsRestored.length, 1, 'position restored');
  });

  test('a partial reorg of only the registration block reverts the registration counters but keeps the bond', async () => {
    // Genesis.
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' }).build()
    );
    // Block 2 (fork A): the bond itself — setup + allowlist (the SHARED ancestor).
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xa2',
        index_block_hash: '0xa2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: SETUP_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: {
            bond_index: String(BOND_INDEX),
            staker: ALICE,
            max_sats: ALICE_MAX_SATS.toString(),
          },
        })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: { bond_index: String(BOND_INDEX), staker: BOB, max_sats: BOB_MAX_SATS.toString() },
        })
        .build()
    );
    // Block 3 (fork A): alice registers — this is the block we'll orphan.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xa3',
        index_block_hash: '0xa3',
        parent_block_hash: '0xa2',
        parent_index_block_hash: '0xa2',
      })
        .addTx({ tx_id: REGISTER_TX_ID })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: {
            bond_index: String(BOND_INDEX),
            signer: SIGNER,
            staker: ALICE,
            amount_ustx: AMOUNT_USTX.toString(),
            sats_total: SBTC_SATS.toString(),
            first_reward_cycle: String(FIRST_REWARD_CYCLE),
            unlock_burn_height: String(UNLOCK_BURN_HEIGHT),
            unlock_cycle: String(UNLOCK_CYCLE),
            is_l1_lock: false,
          },
        })
        .build()
    );

    // With the registration applied, the registration-affected counters reflect it.
    const withReg = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_INDEX}`);
    assert.equal(withReg.registrations.registered_count, 1, 'registered_count = 1');
    assert.equal(BigInt(withReg.balances.locked.stx), AMOUNT_USTX, 'stx_locked reflects registration');
    assert.equal(BigInt(withReg.balances.locked.btc), SBTC_SATS, 'btc_locked reflects registration');
    // Allowlist counters (from the surviving block) are present.
    assert.equal(withReg.registrations.allowed_count, 2);
    assert.equal(BigInt(withReg.parameters.btc_capacity), EXPECTED_BTC_CAPACITY);

    // Partial reorg: fork B branches from block 2 and overtakes, orphaning ONLY
    // block 3 (the registration). The setup/allowlist block 2 stays canonical.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0xa2',
        parent_index_block_hash: '0xa2',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        block_hash: '0xb4',
        index_block_hash: '0xb4',
        parent_block_hash: '0xb3',
        parent_index_block_hash: '0xb3',
      }).build()
    );

    // The bond survives, but the registration counters revert to zero...
    assert.equal(await bondExists(), true, 'bond still exists (its setup block survived)');
    const afterReorg = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_INDEX}`);
    assert.equal(afterReorg.registrations.registered_count, 0, 'registered_count reverted');
    assert.equal(BigInt(afterReorg.balances.locked.stx), 0n, 'stx_locked reverted');
    assert.equal(BigInt(afterReorg.balances.locked.btc), 0n, 'btc_locked reverted');
    // ...while the allowlist counters (from the surviving block) are unchanged.
    assert.equal(afterReorg.registrations.allowed_count, 2, 'allowed_count intact');
    assert.equal(BigInt(afterReorg.parameters.btc_capacity), EXPECTED_BTC_CAPACITY, 'btc_capacity intact');

    // The registration and position are gone.
    const regs = await getJson<CursorPaginated<BondRegistration>>(
      `/extended/v3/staking/bonds/${BOND_INDEX}/registrations?limit=50`
    );
    assert.equal(regs.results.length, 0, 'registration orphaned');
    assert.equal(regs.total, 0, 'registration total reverted');
    const positions = await getJson<PrincipalBondPositionItem[]>(
      `/extended/v3/principals/${ALICE}/balances/staking`
    );
    assert.equal(positions.length, 0, 'position orphaned');
  });
});

/**
 * unstake-sbtc / announce-l1-early-exit: a registered staker exits their bond.
 *   - unstake-sbtc reduces (and at 0, clears) the staker's locked sBTC and the
 *     bond's btc_locked total; a full unstake also marks the position early_exit.
 *   - announce-l1-early-exit marks the position early_exit + inactive without
 *     changing locked balances.
 */
describe('pox-5 bonds unstake / early-exit', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const UNSTAKE_PARTIAL_SATS = 400n;

  async function getJson<T>(path: string): Promise<T> {
    const res = await supertest(api.server).get(path);
    assert.equal(res.status, 200, `GET ${path} -> ${res.status}: ${res.text}`);
    return JSON.parse(res.text) as T;
  }
  function alicePosition(positions: PrincipalBondPositionItem[]): PrincipalBondPositionItem {
    const pos = positions.find(p => p.bond_index === BOND_INDEX);
    assert.ok(pos, `alice has a position for bond #${BOND_INDEX}`);
    return pos;
  }
  const getPositions = () =>
    getJson<PrincipalBondPositionItem[]>(`/extended/v3/principals/${ALICE}/balances/staking`);
  const getBond = () => getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_INDEX}`);

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false, skipMigrations: true });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    // Seed: a bond with alice registered (active, enrolled position).
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' })
        .addTx({ tx_id: SETUP_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: { bond_index: String(BOND_INDEX), staker: ALICE, max_sats: ALICE_MAX_SATS.toString() },
        })
        .addTx({ tx_id: REGISTER_TX_ID })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: {
            bond_index: String(BOND_INDEX),
            signer: SIGNER,
            staker: ALICE,
            amount_ustx: AMOUNT_USTX.toString(),
            sats_total: SBTC_SATS.toString(),
            first_reward_cycle: String(FIRST_REWARD_CYCLE),
            unlock_burn_height: String(UNLOCK_BURN_HEIGHT),
            unlock_cycle: String(UNLOCK_CYCLE),
            is_l1_lock: false,
          },
        })
        .build()
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('the seeded position starts active and enrolled with the locked sBTC', async () => {
    const pos = alicePosition(await getPositions());
    assert.equal(pos.status, 'enrolled');
    assert.equal(pos.active, true);
    assert.equal(BigInt(pos.balances.locked.btc), SBTC_SATS);
    const bond = await getBond();
    assert.equal(BigInt(bond.balances.locked.btc), SBTC_SATS);
  });

  test('unstake-sbtc reduces, then (at 0) clears the position + bond locked sBTC', async () => {
    // Partial unstake: position + bond btc_locked drop to the new amount.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: '0x' + 'a2'.repeat(32) })
        .addTxPox5Event({
          name: Pox5EventName.UnstakeSbtc,
          data: {
            bond_index: String(BOND_INDEX),
            staker: ALICE,
            new_amount_sats: UNSTAKE_PARTIAL_SATS.toString(),
          },
        })
        .build()
    );
    let pos = alicePosition(await getPositions());
    assert.equal(BigInt(pos.balances.locked.btc), UNSTAKE_PARTIAL_SATS, 'position sBTC reduced');
    assert.equal(pos.status, 'enrolled', 'still enrolled on a partial unstake');
    assert.equal(BigInt((await getBond()).balances.locked.btc), UNSTAKE_PARTIAL_SATS, 'bond btc_locked reduced');

    // Full unstake (to 0): position sBTC cleared and marked early_exit.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0x03',
        index_block_hash: '0x03',
        parent_block_hash: '0x02',
        parent_index_block_hash: '0x02',
      })
        .addTx({ tx_id: '0x' + 'a3'.repeat(32) })
        .addTxPox5Event({
          name: Pox5EventName.UnstakeSbtc,
          data: { bond_index: String(BOND_INDEX), staker: ALICE, new_amount_sats: '0' },
        })
        .build()
    );
    pos = alicePosition(await getPositions());
    assert.equal(BigInt(pos.balances.locked.btc), 0n, 'position sBTC cleared');
    assert.equal(pos.status, 'early_exit', 'marked early_exit on full unstake');
    assert.equal(BigInt((await getBond()).balances.locked.btc), 0n, 'bond btc_locked cleared');
  });

  test('announce-l1-early-exit marks the position early_exit + inactive, keeping locked balances', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: '0x' + 'b2'.repeat(32) })
        .addTxPox5Event({
          name: Pox5EventName.AnnounceL1EarlyExit,
          data: { bond_index: String(BOND_INDEX), staker: ALICE },
        })
        .build()
    );
    const pos = alicePosition(await getPositions());
    assert.equal(pos.status, 'early_exit', 'status -> early_exit');
    assert.equal(pos.active, false, 'position deactivated');
    // Announcing an exit does not move funds; locked balances are unchanged.
    assert.equal(BigInt(pos.balances.locked.btc), SBTC_SATS, 'locked sBTC unchanged');
    assert.equal(BigInt((await getBond()).balances.locked.btc), SBTC_SATS, 'bond btc_locked unchanged');
  });
});

/**
 * Reward accrual: each pox-5 `bond-distribution` event is split across the
 * bond's participants by staked weight and accrued onto their position; the
 * accrual is reorg-safe (reverts if the distribution block is orphaned).
 */
describe('pox-5 bonds reward accrual', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const BOB_REGISTER_TX_ID = '0x' + '33'.repeat(32);
  const DIST_TX_ID = '0x' + 'd1'.repeat(32);
  const ALICE_SATS = 1_000n;
  const BOB_SATS = 4_000n;
  // 2 reward sats per staked sat (PRECISION = 1e18).
  const ACCRUED_PER_SAT = (2n * 1_000_000_000_000_000_000n).toString();
  const ALICE_EXPECTED = ALICE_SATS * 2n; // 2000
  const BOB_EXPECTED = BOB_SATS * 2n; // 8000

  async function getJson<T>(path: string): Promise<T> {
    const res = await supertest(api.server).get(path);
    assert.equal(res.status, 200, `GET ${path} -> ${res.status}: ${res.text}`);
    return JSON.parse(res.text) as T;
  }
  async function accruedFor(principal: string): Promise<bigint> {
    const positions = await getJson<PrincipalBondPositionItem[]>(
      `/extended/v3/principals/${principal}/balances/staking`
    );
    const pos = positions.find(p => p.bond_index === BOND_INDEX);
    assert.ok(pos, `position for ${principal}`);
    return BigInt(pos.accrued_rewards);
  }
  function registerEvent(staker: string, sats: bigint) {
    return {
      bond_index: String(BOND_INDEX),
      signer: SIGNER,
      staker,
      amount_ustx: AMOUNT_USTX.toString(),
      sats_total: sats.toString(),
      first_reward_cycle: String(FIRST_REWARD_CYCLE),
      unlock_burn_height: String(UNLOCK_BURN_HEIGHT),
      unlock_cycle: String(UNLOCK_CYCLE),
      is_l1_lock: false,
    };
  }
  function distributionBlock(args: {
    block_height: number;
    block_hash: string;
    index_block_hash: string;
    parent_block_hash: string;
    parent_index_block_hash: string;
  }) {
    return new TestBlockBuilder(args)
      .addTx({ tx_id: DIST_TX_ID })
      .addTxPox5Event({
        name: Pox5EventName.BondDistribution,
        data: {
          bond_index: String(BOND_INDEX),
          target_yield: '0',
          bond_rewards: ((ALICE_SATS + BOB_SATS) * 2n).toString(),
          bond_staked_sats: (ALICE_SATS + BOB_SATS).toString(),
          accrued_rewards_per_sat: ACCRUED_PER_SAT,
          cumulative_rewards_per_sat: ACCRUED_PER_SAT,
        },
      })
      .build();
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false, skipMigrations: true });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    // Seed (block 1): bond with alice + bob registered at different weights.
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' })
        .addTx({ tx_id: SETUP_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: { bond_index: String(BOND_INDEX), staker: ALICE, max_sats: ALICE_MAX_SATS.toString() },
        })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: { bond_index: String(BOND_INDEX), staker: BOB, max_sats: BOB_MAX_SATS.toString() },
        })
        .addTx({ tx_id: REGISTER_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.RegisterForBond, data: registerEvent(ALICE, ALICE_SATS) })
        .addTx({ tx_id: BOB_REGISTER_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.RegisterForBond, data: registerEvent(BOB, BOB_SATS) })
        .build()
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('a bond-distribution accrues rewards to participants by staked weight', async () => {
    // No rewards before the distribution.
    assert.equal(await accruedFor(ALICE), 0n);
    assert.equal(await accruedFor(BOB), 0n);

    await db.update(
      distributionBlock({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
    );

    // alice has 1/5 of the weight, bob 4/5 — split 2 sats per staked sat.
    assert.equal(await accruedFor(ALICE), ALICE_EXPECTED);
    assert.equal(await accruedFor(BOB), BOB_EXPECTED);
  });

  test('orphaning the distribution block reverts the accrued rewards', async () => {
    await db.update(
      distributionBlock({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
    );
    assert.equal(await accruedFor(ALICE), ALICE_EXPECTED);
    assert.equal(await accruedFor(BOB), BOB_EXPECTED);

    // Fork B branches from the seed (block 1) and overtakes, orphaning the
    // distribution block — the seed/positions survive, the accrual reverts.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0xb2',
        index_block_hash: '0xb2',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0xb2',
        parent_index_block_hash: '0xb2',
      }).build()
    );

    assert.equal(await accruedFor(ALICE), 0n, 'alice accrual reverted');
    assert.equal(await accruedFor(BOB), 0n, 'bob accrual reverted');
  });
});
