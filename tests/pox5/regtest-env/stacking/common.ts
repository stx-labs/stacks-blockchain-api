import { StackingClient } from '@stacks/stacking';
import { STACKS_TESTNET } from '@stacks/network';
import { ClarityType, deserializeCV, getAddressFromPrivateKey } from '@stacks/transactions';
import { getPublicKeyFromPrivate, publicKeyToBtcAddress } from '@stacks/encryption';
import { createClient } from '@stacks/blockchain-api-client';
import { Logger, pino } from 'pino';

const serviceName = process.env.SERVICE_NAME || 'JS';
export let logger: Logger;
if (process.env.STACKS_LOG_JSON === '1') {
  logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    name: serviceName,
  });
} else {
  logger = pino({
    name: serviceName,
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
    },
    // @ts-ignore
    options: {
      colorize: true,
    },
  });
}

export const CHAIN_ID = parseEnvInt('STACKS_CHAIN_ID', false) ?? STACKS_TESTNET.chainId;

export const nodeUrl = `http://${process.env.STACKS_CORE_RPC_HOST}:${process.env.STACKS_CORE_RPC_PORT}`;
export const network = STACKS_TESTNET;
network.chainId = CHAIN_ID;
network.client.baseUrl = nodeUrl;
export const apiClient = createClient({
  baseUrl: nodeUrl,
});

export const EPOCH_30_START = parseEnvInt('STACKS_30_HEIGHT', true);
export const EPOCH_25_START = parseEnvInt('STACKS_25_HEIGHT', true);
export const EPOCH_40_START = parseEnvInt('STACKS_40_HEIGHT', true);
export const POX_PREPARE_LENGTH = parseEnvInt('POX_PREPARE_LENGTH', true);
export const POX_REWARD_LENGTH = parseEnvInt('POX_REWARD_LENGTH', true);
export const WALLET_NAME = 'btc_staking';

export const accounts = process.env.STACKING_KEYS!.split(',').map((privKey, index) => {
  const pubKey = getPublicKeyFromPrivate(privKey);
  const stxAddress = getAddressFromPrivateKey(privKey, network);
  const signerPrivKey = privKey;
  const signerPubKey = getPublicKeyFromPrivate(signerPrivKey);
  return {
    privKey,
    pubKey,
    stxAddress,
    btcAddr: publicKeyToBtcAddress(pubKey),
    signerPrivKey: signerPrivKey,
    signerPubKey: signerPubKey,
    targetSlots: index + 1,
    index,
    client: new StackingClient({
      address: stxAddress,
      network,
    }),
    logger: logger.child({
      account: stxAddress,
      index: index,
    }),
    signerManager: `${stxAddress}.signer-manager`,
  };
});

export async function fetchAccount(stxAddress: string) {
  const url = `${nodeUrl}/v2/accounts/${stxAddress}?proof=0`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    unlock_height: number;
    locked: string;
    balance: string;
    nonce: number;
  };
  const locked = deserializeCV(data.locked.slice(2));
  const balance = deserializeCV(data.balance.slice(2));
  if (locked.type !== ClarityType.Int || balance.type !== ClarityType.Int) {
    logger.error({ locked, balance }, 'Invalid account data');
    throw new Error('Invalid account data');
  }
  return {
    unlockHeight: data.unlock_height,
    lockedAmount: BigInt(locked.value),
    balance: BigInt(balance.value),
    nonce: data.nonce,
  };
}

export type Account = typeof accounts[0];

export const MAX_U128 = 2n ** 128n - 1n;
export const maxAmount = MAX_U128;

export async function waitForSetup() {
  try {
    await accounts[0]!.client.getPoxInfo();
  } catch (error) {
    if (
      error instanceof Error &&
      'cause' in error &&
      error.cause instanceof Error &&
      /(ECONNREFUSED|ENOTFOUND|SyntaxError)/.test(error.cause.message)
    ) {
      console.log(`Stacks node not ready, waiting...`);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    return waitForSetup();
  }
}

export function parseEnvInt<T extends boolean = false>(
  envKey: string,
  required?: T
): T extends true ? number : number | undefined {
  let value = process.env[envKey];
  if (typeof value === 'undefined') {
    if (required) {
      throw new Error(`Missing required env var: ${envKey}`);
    }
    return undefined as T extends true ? number : number | undefined;
  }
  if (value.startsWith('0x')) {
    return parseInt(value, 16);
  }
  return parseInt(value, 10);
}

export function burnBlockToRewardCycle(burnBlock: number) {
  const cycleLength = BigInt(POX_REWARD_LENGTH);
  return Number(BigInt(burnBlock) / cycleLength) + 1;
}

export const EPOCH_30_START_CYCLE = burnBlockToRewardCycle(EPOCH_30_START);

export function isPreparePhase(burnBlock: number) {
  return POX_REWARD_LENGTH - (burnBlock % POX_REWARD_LENGTH) < POX_PREPARE_LENGTH;
}

export function didCrossPreparePhase(lastBurnHeight: number, newBurnHeight: number) {
  return isPreparePhase(newBurnHeight) && !isPreparePhase(lastBurnHeight);
}

export async function waitForTxConfirmed(txid: string) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timeoutMs = 120_000;
    const interval = setInterval(async () => {
      const { data: tx, ...rest } = await apiClient.GET(`/extended/v1/tx/{tx_id}`, {
        params: {
          path: {
            tx_id: txid,
          },
        },
      });
      if (!tx) {
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Timed out waiting for tx ${txid}`));
          return;
        }
        logger.warn({ ...rest }, 'Waiting for tx to be confirmed');
        return;
      }
      if (tx.tx_status !== 'pending') {
        if (tx.tx_status !== 'success') {
          logger.error({ ...tx }, 'Tx failed');
          clearInterval(interval);
          reject(new Error(`Tx ${txid} failed with status ${tx.tx_status}`));
          return;
        }
        clearInterval(interval);
        resolve(tx);
      }
    }, 500);
  });
}
