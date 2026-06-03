import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getPox5Context, stopPox5Context, type Pox5Context } from './pox5-env.ts';

/**
 * End-to-end harness smoke test.
 *
 * Exercises the full pipeline without asserting any chain behavior yet:
 *   1. `setup.ts` (global) has already booted the dockerized chain + postgres.
 *   2. `getPox5Context()` starts the in-process API + event server and connects
 *      to the dockerized node/bitcoind/postgres.
 *   3. A trivial assertion confirms the suite runs green start-to-finish.
 *
 * Once this passes reliably, real pox-5 / bitcoin-staking assertions get added
 * as sibling `*.test.ts` files using the same context + `standByFor*` helpers.
 */
describe('pox5 e2e harness smoke test', () => {
  let ctx: Pox5Context;

  before(async () => {
    ctx = await getPox5Context();
  });

  after(async () => {
    if (ctx) {
      await stopPox5Context(ctx);
    }
  });

  test('harness boots and the suite runs end-to-end', () => {
    assert.ok(true);
  });
});
