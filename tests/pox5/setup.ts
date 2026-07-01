import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dockerComposeTestDown,
  dockerComposeTestUp,
  type DockerComposeTestConfig,
} from '@stacks/api-test-toolkit';

/**
 * Global setup/teardown for the pox-5 + bitcoin-staking e2e suite.
 *
 * Unlike the `krypton` and `snp` suites (which boot single pre-built images via
 * `dockerTestUp`), the pox-5 environment needs the full multi-service
 * `docker compose` stack copied from `stacks-regtest-env`:
 *
 *   - bitcoind + bitcoind-miner  regtest BTC node, auto-mines blocks, funds the
 *                                `btc_staking` wallet used by the btc-staker
 *   - stacks-node                Nakamoto/epoch-4 miner, built from the
 *                                `feat/epoch-4-rc` stacks-blockchain commit
 *   - stacks-signer-{1,2,3}      the signer set
 *   - stacker                    pox-4 auto-stacker (talks to the node directly)
 *   - btc-staker                 pox-5 bitcoin-staking + sbtc deployer
 *   - monitor / tx-broadcaster   chain progression + nakamoto block production
 *   - postgres                   chainstate DB for the API
 *
 * The Stacks API itself is intentionally NOT containerized: the miner posts
 * events to `host.docker.internal:3700` and the btc-staker/monitor query the
 * API at `host.docker.internal:3999`. The API + event server are started
 * in-process by the test files (see the upcoming pox5-env helper), exactly the
 * way `krypton-env.ts` does it. This setup only owns the docker lifecycle.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

function pox5ComposeConfig(): DockerComposeTestConfig {
  return {
    projectName: 'stacks-api-test-pox5',
    composeFile: join(__dirname, 'regtest-env', 'docker-compose.yml'),
    // Run docker quietly (capture output, surface only on failure) so the
    // console stays focused on the test runner. Heartbeat lines report progress
    // during the build/boot/readiness waits; set DEBUG_COMPOSE=1 to stream the
    // full docker output instead.
    inheritStdio: process.env.DEBUG_COMPOSE === '1',
    // Only wait for postgres here — NOT the stacks-node.
    //
    // The node posts events to the in-process event server at host:3700 and
    // makes no chain progress until that server is up and draining events. The
    // event server is started later by `getPox5Context()` (in the test's
    // before-hook), so gating container readiness on node/chain progress here
    // would deadlock: setup waits on the node, the node waits on an event server
    // that setup never lets us start. Node readiness is therefore checked inside
    // `getPox5Context()`, after the event server is listening. Postgres comes up
    // independently and is needed before the API runs migrations.
    waitFor: [{ type: 'port', port: 5490, label: 'postgres' }],
  };
}

export async function globalSetup() {
  await dockerComposeTestUp({ config: pox5ComposeConfig() });
  process.stdout.write(`[testenv:pox5] all containers ready\n`);
}

export async function globalTeardown() {
  await dockerComposeTestDown({ config: pox5ComposeConfig() });
  process.stdout.write(`[testenv:pox5] all containers removed\n`);
}
