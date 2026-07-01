import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  makeContractDeploy,
} from '@stacks/transactions';
import { hex } from '@scure/base';
import { PoxInfo } from '@stacks/stacking';
import {
  accounts,
  parseEnvInt,
  waitForSetup,
  logger,
  burnBlockToRewardCycle,
  network,
  POX_REWARD_LENGTH,
  type Account,
  EPOCH_40_START,
  WALLET_NAME,
  waitForTxConfirmed,
  EPOCH_30_START,
  fetchAccount,
} from './common.js';
import {
  getUnlockBytes,
  serializeLockupScript,
  calculateUnlockBurnHeight,
  getLockingAddress,
  createOrLoadWallet,
  listUnspent,
  sendToAddress,
} from './btc-helpers.js';
import { signSignerKeyGrant, pox5, pox5Signer, clarigenClient } from './pox-5-helpers.js';
import { readFile } from 'node:fs/promises';

const stakingInterval = parseEnvInt('STACKING_INTERVAL', true);
const stakingCyclesPox5 = parseEnvInt('STACKING_CYCLES_POX_5', true);
const lockAmountSats = BigInt(parseEnvInt('BTC_LOCK_AMOUNT_SATS', false) ?? 10_000_000);

let txFee = parseEnvInt('STACKING_FEE', false) ?? 1_000_000;
const getNextTxFee = () => txFee++;

// -- Initialization --

async function initBtcWallet() {
  await createOrLoadWallet(WALLET_NAME);
  logger.info({ wallet: WALLET_NAME }, 'Bitcoin staking wallet ready');

  // Wait for miner to fund the wallet
  while (true) {
    const utxos = await listUnspent(WALLET_NAME, 1);
    const total = utxos.reduce((sum, u) => sum + u.amount, 0);
    if (total > 0) {
      logger.info({ balance: total }, 'Staking wallet funded');
      return;
    }
    logger.info('Waiting for staking wallet to be funded...');
    await new Promise(r => setTimeout(r, 5000));
  }
}

// -- L2: Stacks contract calls --

async function submitStake(account: Account, poxInfo: PoxInfo) {
  const stakeFnCall = pox5.stake({
    startBurnHt: poxInfo.current_burnchain_block_height!,
    amountUstx: 100_000_000000n,
    numCycles: stakingCyclesPox5,
    signerManager: account.signerManager,
    signerCalldata: null,
  });

  const tx = await makeContractCall({
    ...stakeFnCall,
    senderKey: account.privKey,
    network,
    fee: getNextTxFee(),
    nonce: (await fetchAccount(account.stxAddress)).nonce,
  });
  const result = await broadcastTransaction({
    transaction: tx,
    network,
  });
  if ('reason' in result) {
    account.logger.error(
      {
        ...result,
      },
      `Error staking: ${result.reason}`
    );
    throw new Error(`Error staking: ${result.reason}`);
  }
  account.logger.info({ ...result }, 'stake tx broadcast');
  return result;
}

async function submitStakeExtend(account: Account) {
  const txOptions = {
    ...pox5.stakeUpdate({
      amountIncrease: 0n,
      cyclesToExtend: stakingCyclesPox5,
      signerManager: account.signerManager,
      oldSignerManager: account.signerManager,
      signerCalldata: null,
    }),
    senderKey: account.privKey,
    network,
    fee: getNextTxFee(),
    anchorMode: AnchorMode.Any,
  };

  const tx = await makeContractCall(txOptions);
  const result = await broadcastTransaction({
    transaction: tx,
    network,
  });
  if ('reason' in result) {
    account.logger.error({ ...result }, `Error extending stake: ${result.reason}`);
    throw new Error(`Error extending stake: ${result.reason}`);
  }
  account.logger.info({ txid: result.txid }, 'L2 stake-extend tx broadcast');
  return result;
}

// -- L1: Bitcoin locking transaction --

async function submitBtcLock(account: Account, unlockBurnHeight: bigint, unlockBytes: Uint8Array) {
  const lockScript = serializeLockupScript({
    stacker: account.stxAddress,
    unlockBurnHeight,
    unlockBytes,
  });

  const address = getLockingAddress(lockScript);
  const amountBtc = Number(lockAmountSats) / 1e8;

  const txid = await sendToAddress(WALLET_NAME, address, amountBtc);
  account.logger.info(
    { txid, address, amountBtc, unlockBurnHeight: unlockBurnHeight.toString() },
    'L1 BTC lock tx broadcast'
  );
  return txid;
}

// -- Main loop --

const grantedSignerKeys = new Set<string>();
let hasDeployedSBTC = false;

async function run() {
  const poxInfo = await accounts[0]!.client.getPoxInfo();

  if (poxInfo.current_burnchain_block_height! > EPOCH_30_START + 1 && !hasDeployedSBTC) {
    await deploySBTC(accounts[0]!);
    hasDeployedSBTC = true;
  }
  if (poxInfo.current_burnchain_block_height! < EPOCH_40_START) {
    // logger.info({ burnHeight: poxInfo.current_burnchain_block_height }, 'Not on epoch 3.5 yet, skipping');
    return;
  }

  const currentCycle = poxInfo.reward_cycle_id;

  const accountInfos = await Promise.all(
    accounts.map(async a => {
      const info = await fetchAccount(a.stxAddress);
      return { ...a, ...info };
    })
  );

  const nowCycle = burnBlockToRewardCycle(poxInfo.current_burnchain_block_height ?? 0);

  const txIdsToWait: string[] = [];

  for (const account of accountInfos) {
    const unlockBytes = getUnlockBytes(account.pubKey);
    const unlockBurnHeight = calculateUnlockBurnHeight(
      currentCycle,
      stakingCyclesPox5,
      POX_REWARD_LENGTH
    );

    if (!grantedSignerKeys.has(account.signerManager)) {
      const authId = 2n;
      const signature = signSignerKeyGrant({
        signerManager: account.signerManager,
        authId,
        signerSk: hex.decode(account.signerPrivKey),
      });

      const signerManager = await readFile('./contracts/pox-5-signer.clar', 'utf8');
      const deployTx = await makeContractDeploy({
        senderKey: account.privKey,
        network,
        contractName: 'signer-manager',
        codeBody: signerManager
          .replaceAll(' .pox-5', ` '${pox5.identifier}`)
          .replaceAll(
            'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP'
          ),
      });
      const deployResult = await broadcastTransaction({
        transaction: deployTx,
        network,
      });
      const exists = 'reason' in deployResult && deployResult.reason === 'ContractAlreadyExists';
      if (!exists) {
        if ('reason' in deployResult) {
          throw new Error(`Error deploying signer manager: ${deployResult.reason}`);
        }
        account.logger.info({ ...deployResult }, 'Deployed signer manager');
        await waitForTxConfirmed(deployResult.txid);
      }

      const signerKey = await clarigenClient.ro(pox5.getSignerInfo(account.signerManager));

      if (!signerKey) {
        const registerSelf = await makeContractCall({
          ...pox5Signer(account.signerManager).registerSelf({
            signerManager: account.signerManager,
            signerKey: hex.decode(account.signerPubKey),
            authId,
            signerSig: signature,
          }),
          nonce: (await fetchAccount(account.stxAddress)).nonce,
          senderKey: account.privKey,
          network,
        });
        const registerSelfResult = await broadcastTransaction({
          transaction: registerSelf,
          network,
        });
        if ('reason' in registerSelfResult) {
          throw new Error(`Error registering signer manager: ${registerSelfResult.reason}`);
        }
        account.logger.info({ ...registerSelfResult }, 'Registered self');
        await waitForTxConfirmed(registerSelfResult.txid);
      }
      grantedSignerKeys.add(account.signerManager);
    }

    if (account.lockedAmount === 0n) {
      account.logger.info('Account unlocked, staking...', {
        account: account.index,
        rewardCycle: poxInfo.reward_cycle_id,
        unlockBurnHeight: unlockBurnHeight.toString(),
      });

      const stakeResult = await submitStake(account, poxInfo);
      txIdsToWait.push(stakeResult.txid);

      await submitBtcLock(account, unlockBurnHeight, unlockBytes);
      continue;
    }

    const unlockCycle = burnBlockToRewardCycle(account.unlockHeight);

    if (unlockCycle === nowCycle) {
      account.logger.info(
        { unlockHeight: account.unlockHeight, nowCycle, unlockCycle },
        'Extending stake...'
      );

      const stakeExtendResult = await submitStakeExtend(account);
      txIdsToWait.push(stakeExtendResult.txid);

      await submitBtcLock(account, unlockBurnHeight, unlockBytes);
      continue;
    }

    // account.logger.info({ nowCycle, unlockCycle }, 'Staked through next cycle, skipping');
  }
  await Promise.all(txIdsToWait.map(waitForTxConfirmed));
}

async function deploySBTC(account: Account) {
  const registry = await readFile(
    'contracts/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry.clar',
    'utf8'
  );
  const token = await readFile(
    'contracts/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token.clar',
    'utf8'
  );
  const withdrawal = await readFile(
    'contracts/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal.clar',
    'utf8'
  );

  async function deployContract(contract: string, name: string) {
    const deployTx = await makeContractDeploy({
      senderKey: accounts[0]!.privKey,
      network,
      contractName: name,
      codeBody: contract,
      clarityVersion: 3,
    });
    const deployResult = await broadcastTransaction({
      transaction: deployTx,
      network,
    });
    if ('reason' in deployResult) {
      if (deployResult.reason === 'ContractAlreadyExists') {
        return;
      }
      throw new Error(`Error deploying sbtc contract: ${deployResult.reason}`);
    }
    account.logger.info({ ...deployResult, contractName: name }, 'Deployed sbtc contract');
    await waitForTxConfirmed(deployResult.txid);
  }

  await deployContract(registry, 'sbtc-registry');
  await deployContract(token, 'sbtc-token');
  await deployContract(withdrawal, 'sbtc-withdrawal');
}

async function loop() {
  await waitForSetup();
  await initBtcWallet();

  while (true) {
    try {
      await run();
    } catch (e) {
      logger.error(e, 'Error in btc-staker loop');
    }
    await new Promise(r => setTimeout(r, stakingInterval * 1000));
  }
}

loop();
