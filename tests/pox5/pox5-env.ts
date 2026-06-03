import {
  bufferCV,
  ClarityValue,
  getAddressFromPrivateKey,
  tupleCV,
  TupleCV,
} from '@stacks/transactions';
import { ENV } from '../../src/env.ts';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server.ts';
import { migrate } from '../test-helpers.ts';
import { PgWriteStore } from '../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../src/api/init.ts';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../../src/core-rpc/client.ts';
import { coerceToBuffer, timeout } from '@stacks/api-toolkit';
import { ChainId, createNetwork, STACKS_TESTNET } from '@stacks/network';
import type { StacksNetwork } from '@stacks/network';
import { RPCClient } from 'rpc-bitcoin';
import { ClarityTypeID, decodeClarityValue } from '@stacks/codec';
import type { ClarityValue as DecodedClarityValue } from '@stacks/codec';
import { decodeBtcAddress } from '@stacks/stacking';
import { FAUCET_TESTNET_KEYS } from '../../src/api/routes/v1/faucets.ts';
import { AddressStxBalance } from '../../src/api/schemas/v1/entities/addresses.ts';
import { DbBlock, DbTx, DbTxStatus } from '../../src/datastore/common.ts';
// Reuse the krypton bitcoin key/address helpers instead of duplicating them.
import { BitcoinAddressFormat, ECPair, getBitcoinAddressFromKey } from '../krypton/ec-helpers.ts';
import { hexToBytes } from '@stacks/common';
import supertest from 'supertest';
import assert from 'node:assert/strict';

/**
 * In-process test harness for the pox-5 / bitcoin-staking suite.
 *
 * `tests/pox5/setup.ts` (the global setup) owns the dockerized chain
 * (bitcoind + stacks-node + signers + staking sidecars + postgres). This module
 * starts the Stacks API + event server *in-process on the host* — the
 * dockerized node posts events to `host.docker.internal:3700` and the staking
 * sidecars query the API at `host.docker.internal:3999`, so the API must live on
 * the host. This mirrors `krypton-env.ts`.
 *
 * Connection details come from `.env` (already pointed at the regtest stack:
 * PG 5490, node RPC 20443, bitcoind 18443, event port 3700, chain 0x80000000).
 */
export interface Pox5Context {
  db: PgWriteStore;
  eventServer: EventStreamServer;
  api: ApiServer;
  client: StacksCoreRpcClient;
  stacksNetwork: StacksNetwork;
  bitcoinRpcClient: RPCClient;
}

export type Account = {
  secretKey: string;
  pubKey: string;
  stxAddr: string;
  btcAddr: string;
  btcTestnetAddr: string;
  poxAddr: { version: number; data: string };
  poxAddrClar: TupleCV;
  wif: string;
};

export function accountFromKey(
  privateKey: string,
  addressFormat: BitcoinAddressFormat = 'p2pkh'
): Account {
  const privKeyBuff = coerceToBuffer(privateKey);
  if (privKeyBuff.byteLength !== 33) {
    throw new Error('Only compressed private keys supported');
  }
  const ecPair = ECPair.fromPrivateKey(privKeyBuff.slice(0, 32), { compressed: true });
  const secretKey = ecPair.privateKey!.toString('hex') + '01';
  if (secretKey.slice(0, 64) !== privateKey.slice(0, 64)) {
    throw new Error(`key mismatch`);
  }
  const pubKey = ecPair.publicKey.toString('hex');
  const stxAddr = getAddressFromPrivateKey(secretKey, 'testnet');
  const btcAccount = getBitcoinAddressFromKey({
    privateKey: ecPair.privateKey!,
    network: 'regtest',
    addressFormat,
    verbose: true,
  });
  const btcAddr = btcAccount.address;
  const poxAddr = decodeBtcAddress(btcAddr);
  const poxAddrClar = tupleCV({
    hashbytes: bufferCV(hexToBytes(poxAddr.data)),
    version: bufferCV(Buffer.from([poxAddr.version])),
  });
  const wif = btcAccount.wif;
  const btcTestnetAddr = getBitcoinAddressFromKey({
    privateKey: ecPair.privateKey!,
    network: 'testnet',
    addressFormat,
  });
  return { secretKey, pubKey, stxAddr, poxAddr, poxAddrClar, btcAddr, btcTestnetAddr, wif };
}

// -- Stand-by helpers (poll the API datastore / node RPC for chain progress) --

export async function standByUntilBurnBlock(
  burnBlockHeight: number,
  ctx: Pox5Context
): Promise<DbBlock> {
  let blockFound = false;
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    while (!blockFound) {
      const dbBlock = await ctx.api.datastore.getBlockByBurnBlockHeight(burnBlockHeight);
      if (dbBlock.found) {
        blockFound = true;
        resolve(dbBlock.result);
      } else {
        await timeout(50);
      }
    }
  });
  return dbBlock;
}

export async function standByUntilBlock(blockHeight: number, ctx: Pox5Context): Promise<DbBlock> {
  let blockFound = false;
  const dbBlock = await new Promise<DbBlock>(async resolve => {
    while (!blockFound) {
      const dbBlock = await ctx.api.datastore.getBlock({ height: blockHeight });
      if (dbBlock.found) {
        blockFound = true;
        resolve(dbBlock.result);
      } else {
        await timeout(50);
      }
    }
  });
  return dbBlock;
}

export async function standByForTx(expectedTxId: string, ctx: Pox5Context): Promise<DbTx> {
  console.log(`Waiting for TX: ${expectedTxId}...`);
  const tx = await new Promise<DbTx>(async resolve => {
    let found = false;
    do {
      const dbTxQuery = await ctx.api.datastore.getTx({
        txId: expectedTxId,
        includeUnanchored: false,
      });
      if (dbTxQuery.found) {
        found = true;
        console.log(`Found TX: ${expectedTxId}`);
        resolve(dbTxQuery.result);
      } else {
        await timeout(100);
      }
    } while (!found);
  });
  return tx;
}

export async function standByForTxSuccess(expectedTxId: string, ctx: Pox5Context): Promise<DbTx> {
  const tx = await standByForTx(expectedTxId, ctx);
  if (tx.status !== DbTxStatus.Success) {
    const resultRepr = decodeClarityValue(tx.raw_result).repr;
    throw new Error(`Tx failed with status ${tx.status}, result: ${resultRepr}`);
  }
  return tx;
}

/** Stand by until the prepare phase of the next pox cycle (still in current cycle). */
export async function standByForNextPoxCycle(ctx: Pox5Context): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await ctx.client.getPox();
  await standByUntilBurnBlock(firstPoxInfo.next_cycle.prepare_phase_start_block_height, ctx);
  return await ctx.client.getPox();
}

/** Stand by until the burn height reaches the start of the next cycle. */
export async function standByForPoxCycle(ctx: Pox5Context): Promise<CoreRpcPoxInfo> {
  const firstPoxInfo = await ctx.client.getPox();
  let lastPoxInfo: CoreRpcPoxInfo = JSON.parse(JSON.stringify(firstPoxInfo));
  do {
    await standByUntilBurnBlock(lastPoxInfo.current_burnchain_block_height! + 1, ctx);
    lastPoxInfo = await ctx.client.getPox();
  } while (
    (lastPoxInfo.current_burnchain_block_height as number) <=
    firstPoxInfo.next_cycle.reward_phase_start_block_height
  );
  return lastPoxInfo;
}

export async function standByForAccountUnlock(address: string, ctx: Pox5Context): Promise<void> {
  while (true) {
    const accountInfo = await ctx.client.getAccount(address);
    if (BigInt(accountInfo.locked) === 0n) {
      break;
    }
    const info = await ctx.client.getInfo();
    await standByUntilBlock(info.stacks_tip_height + 1, ctx);
  }
}

// -- HTTP / read-only call helpers --

export async function fetchGet<TRes>(endpoint: string, ctx: Pox5Context): Promise<TRes> {
  const result = await supertest(ctx.api.server).get(endpoint);
  // Follow redirects
  if (result.status >= 300 && result.status < 400) {
    return await fetchGet<TRes>(result.header.location, ctx);
  }
  assert.equal(result.status, 200);
  assert.equal(result.type, 'application/json');
  return result.body as TRes;
}

export async function readOnlyFnCall<T extends DecodedClarityValue>(
  contract: string | [string, string],
  fnName: string,
  ctx: Pox5Context,
  args?: ClarityValue[],
  sender?: string,
  unwrap = true
): Promise<T> {
  const [contractAddr, contractName] =
    typeof contract === 'string' ? contract.split('.') : contract;
  const callResp = await ctx.client.sendReadOnlyContractCall(
    contractAddr,
    contractName,
    fnName,
    sender ?? FAUCET_TESTNET_KEYS[0].stacksAddress,
    args ?? []
  );
  if (!callResp.okay) {
    throw new Error(`Failed to call ${contract}::${fnName}`);
  }
  const decodedVal = decodeClarityValue<T>(callResp.result);
  if (unwrap) {
    if (decodedVal.type_id === ClarityTypeID.OptionalSome) return decodedVal.value as T;
    if (decodedVal.type_id === ClarityTypeID.ResponseOk) return decodedVal.value as T;
    if (decodedVal.type_id === ClarityTypeID.OptionalNone) {
      throw new Error(`OptionNone result for call to ${contract}::${fnName}`);
    }
    if (decodedVal.type_id === ClarityTypeID.ResponseError) {
      throw new Error(`ResultError result for call to ${contract}::${fnName}: ${decodedVal.repr}`);
    }
  }
  return decodedVal;
}

// -- Context lifecycle --

/**
 * Wait for the dockerized node RPC to be reachable.
 *
 * This is the real readiness gate for the suite, and it MUST run after the
 * event server is listening (see `getPox5Context`): the node won't progress
 * until it can deliver events to host:3700, so it only becomes RPC-responsive
 * once that server is up to drain its (possibly buffered) events. Deadline-based
 * with progress logging since a cold node boot can take a while.
 */
async function standByForNodeReady(
  client: StacksCoreRpcClient,
  timeoutMs = 5 * 60_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (true) {
    try {
      await client.getInfo();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`Stacks node RPC not reachable within ${timeoutMs}ms: ${error}`);
      }
      if (Date.now() - lastLog >= 15_000) {
        console.log('Waiting for stacks-node RPC (event server is up, draining node events)…');
        lastLog = Date.now();
      }
      await timeout(1000);
    }
  }
}

export async function getPox5Context(): Promise<Pox5Context> {
  process.env.PG_DATABASE = 'postgres';
  ENV.PG_DATABASE = 'postgres';
  ENV.STACKS_CHAIN_ID = '0x80000000';

  await migrate('up');
  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const eventServer = await startEventServer({
    datastore: db,
    chainId: ChainId.Testnet,
    serverHost: '0.0.0.0',
    serverPort: 3700,
  });
  const api = await startApiServer({ datastore: db, writeDatastore: db, chainId: ChainId.Testnet });
  const client = new StacksCoreRpcClient({ host: '127.0.0.1', port: 20443 });
  const stacksNetwork = createNetwork({
    network: STACKS_TESTNET,
    client: { baseUrl: `http://${client.endpoint}` },
  });
  const bitcoinRpcClient = new RPCClient({
    url: ENV.BTC_RPC_HOST,
    port: ENV.BTC_RPC_PORT,
    user: ENV.BTC_RPC_USER,
    pass: ENV.BTC_RPC_PW ?? '',
    timeout: 120000,
    wallet: 'main',
  });

  const ctx: Pox5Context = { db, eventServer, client, stacksNetwork, bitcoinRpcClient, api };

  try {
    await standByForNodeReady(client);
    return ctx;
  } catch (error) {
    await stopPox5Context(ctx);
    throw error;
  }
}

export async function stopPox5Context(ctx: Pox5Context): Promise<void> {
  await ctx.api.forceKill();
  await ctx.eventServer.closeAsync();
  await ctx.db?.close({ timeout: 0 });
}
