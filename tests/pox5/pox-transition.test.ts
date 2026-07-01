import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGet,
  getPox5Context,
  standByForContract,
  standByForPoxContractId,
  standByUntilBurnBlock,
  stopPox5Context,
  waitFor,
  type Pox5Context,
} from './pox5-env.ts';
import { PoxContractIdentifier } from '../../src/event-stream/pox-constants.ts';

/**
 * pox transition e2e — Stacks 2.x → 3.x (Nakamoto) → 4.x (pox-5).
 *
 * Walks the chain through the full epoch progression and verifies the
 * event → DB → API pipeline keeps pace at every step:
 *   - 2.x: the `stacker` sidecar stacks via pox-4 to seat the signer set, and
 *     the `tx-broadcaster` issues stx-transfers — both ingest correctly.
 *   - 3.0 (Nakamoto): the chain enters Nakamoto and blocks keep being ingested.
 *   - 4.0 (pox-5): the active pox contract transitions to pox-5 and ingestion
 *     continues across the boundary.
 *
 * The pox-5-specific event/bond ingestion that the btc-staker triggers
 * (registrations, stake → bond) is covered in a separate test.
 */

// Epoch activation burn heights mirror the regtest-env compose `x-common-vars`
// defaults; override via env if you run a customized compose.
const EPOCH_30_BURN_HEIGHT = Number(process.env.STACKS_30_HEIGHT ?? 131);
const EPOCH_40_BURN_HEIGHT = Number(process.env.STACKS_40_HEIGHT ?? 141);

// Generous ceiling: the chain must advance all the way to epoch 4.0
// (~burn height 141), seating the signer set first.
const READY_TIMEOUT = 25 * 60_000;

interface TransactionSummaryListResponse {
  total: number;
  results: { type: string; status: string; tx_id: string; sender: { address: string } }[];
}

describe('pox transition e2e — Stacks 2.x → 3.x → 4.x', () => {
  let ctx: Pox5Context;

  before(async () => {
    ctx = await getPox5Context();
  }, { timeout: READY_TIMEOUT });

  after(async () => {
    if (ctx) await stopPox5Context(ctx);
  });

  // ---- Stacks 2.x → 3.0 (Nakamoto) ----

  test(
    'chain reaches Nakamoto (epoch 3.0) and the API ingests blocks',
    { timeout: READY_TIMEOUT },
    async () => {
      // Wait until the API has ingested a block at/after the epoch 3.0 burn
      // height — proves block ingestion is keeping pace with the node.
      const nakamotoBlock = await standByUntilBurnBlock(EPOCH_30_BURN_HEIGHT + 1, ctx);
      assert.ok(
        nakamotoBlock.burn_block_height >= EPOCH_30_BURN_HEIGHT,
        `ingested block burn height ${nakamotoBlock.burn_block_height} >= ${EPOCH_30_BURN_HEIGHT}`
      );

      // Read the tip from the API dataset (chain_tip table), not the node RPC:
      // the node can briefly report stacks_tip_height=0 while emitting a block-0
      // re-sync control message, which makes node-side getInfo() checks flaky.
      const chainTip = await ctx.db.getChainTip(ctx.db.sql);
      assert.ok(
        chainTip.block_height > 0,
        `API chain_tip stacks height ${chainTip.block_height} > 0`
      );
      assert.ok(
        chainTip.burn_block_height >= EPOCH_30_BURN_HEIGHT,
        `API chain_tip burn height ${chainTip.burn_block_height} reached Nakamoto`
      );
    }
  );

  test(
    'stacker pox-4 stack-stx txs are ingested as synthetic pox4 events',
    { timeout: READY_TIMEOUT },
    async () => {
      // The `stacker` sidecar stacks via pox-4 (the active contract across epoch
      // 2.5–3.x) to seat the signer set that enables Nakamoto; those calls emit
      // synthetic pox events into the pox4_events table. Their presence is the
      // durable proof that the 2.x pox-4 phase happened, independent of the
      // chain's current epoch.
      const count = await waitFor('pox4_events to be recorded', async () => {
        const rows = await ctx.db.sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM pox4_events WHERE canonical = TRUE
        `;
        return rows[0].count > 0 ? rows[0].count : undefined;
      });
      assert.ok(count > 0, `found ${count} canonical pox4_events`);
    }
  );

  test(
    'the pox-4 boot contract is recorded in smart_contracts',
    { timeout: READY_TIMEOUT },
    async () => {
      // pox-4 is not a genesis boot contract — it's deployed by the boot address
      // at the epoch 2.5 activation, so it's present well before Nakamoto.
      const pox4Id = PoxContractIdentifier.pox4.testnet;
      await standByForContract(ctx, pox4Id);
      const contract = await ctx.api.datastore.getSmartContract(pox4Id);
      assert.ok(contract.found, `${pox4Id} present in smart_contracts`);
    }
  );

  test(
    'tx-broadcaster STX token-transfer txs are ingested',
    { timeout: READY_TIMEOUT },
    async () => {
      // The `tx-broadcaster` sidecar issues periodic stx-transfers post-Nakamoto
      // to drive block production; confirm they ingest and succeed. The v3
      // transactions list is cursor-paginated with no type filter, so filter the
      // recent-tx page client-side.
      const transfer = await waitFor('a successful token_transfer tx', async () => {
        const res = await fetchGet<TransactionSummaryListResponse>(
          '/extended/v3/transactions?limit=50',
          ctx
        );
        return res.results.find(t => t.type === 'token_transfer' && t.status === 'success');
      });
      assert.equal(transfer.type, 'token_transfer');
      assert.equal(transfer.status, 'success');
    }
  );

  // ---- 3.x → 4.0 (pox-5) ----

  test(
    'the active pox contract transitions to pox-5 at epoch 4.0',
    { timeout: READY_TIMEOUT },
    async () => {
      const poxInfo = await standByForPoxContractId(ctx, 'pox-5', READY_TIMEOUT);

      // Active pox contract is now pox-5.
      assert.match(poxInfo.contract_id, /\.pox-5$/);

      const burnHeight = poxInfo.current_burnchain_block_height ?? 0;
      assert.ok(
        burnHeight >= EPOCH_40_BURN_HEIGHT,
        `burn height ${burnHeight} reached epoch 4.0 (${EPOCH_40_BURN_HEIGHT})`
      );

      // The node should advertise pox-5 as an activated contract version.
      // const pox5Version = poxInfo.contract_versions?.find(v => v.contract_id.endsWith('.pox-5'));
      // assert.ok(pox5Version, 'pox-5 present in contract_versions');
      // assert.ok(
      //   pox5Version.activation_burnchain_block_height <= burnHeight,
      //   `pox-5 activation height ${pox5Version.activation_burnchain_block_height} has been reached`
      // );
    }
  );

  test(
    'the pox-5 boot contract is recorded in smart_contracts',
    { timeout: READY_TIMEOUT },
    async () => {
      // Like pox-4, pox-5 is deployed by the boot address at its epoch (4.0)
      // activation, so it lands in smart_contracts once the transition occurs.
      const pox5Id = PoxContractIdentifier.pox5.testnet;
      await standByForContract(ctx, pox5Id);
      const contract = await ctx.api.datastore.getSmartContract(pox5Id);
      assert.ok(contract.found, `${pox5Id} present in smart_contracts`);
    }
  );

  test(
    'pox5_events are recorded after epoch 4.0',
    { timeout: READY_TIMEOUT },
    async () => {
      // Once in epoch 4.0, the btc-staker registers signers and calls
      // pox5.stake, which emits synthetic pox-5 events the API ingests into the
      // pox5_events table. (May lag the transition by a few blocks while the
      // btc-staker deploys its signer-manager and confirms registration.)
      const count = await waitFor('pox5_events to be recorded', async () => {
        const rows = await ctx.db.sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM pox5_events WHERE canonical = TRUE
        `;
        return rows[0].count > 0 ? rows[0].count : undefined;
      });
      assert.ok(count > 0, `found ${count} canonical pox5_events`);
    }
  );

  test(
    'the API keeps ingesting blocks across the transition into epoch 4.0',
    { timeout: READY_TIMEOUT },
    async () => {
      // The epoch 4.0 burn block (and beyond) must be ingested — i.e. the event
      // pipeline didn't stall at the transition.
      const epoch4Block = await standByUntilBurnBlock(EPOCH_40_BURN_HEIGHT, ctx);
      assert.ok(
        epoch4Block.burn_block_height >= EPOCH_40_BURN_HEIGHT,
        `ingested block burn height ${epoch4Block.burn_block_height} >= ${EPOCH_40_BURN_HEIGHT}`
      );

      // Confirm the tip via the API dataset (chain_tip), not the node RPC.
      const chainTip = await ctx.db.getChainTip(ctx.db.sql);
      assert.ok(
        chainTip.burn_block_height >= EPOCH_40_BURN_HEIGHT,
        `API chain_tip burn height ${chainTip.burn_block_height} is in epoch 4.0`
      );
    }
  );
});
