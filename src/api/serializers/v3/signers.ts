import { DbStakingSigner, DbStakingSignerDetail } from '../../../datastore/v3/types.js';
import { StakingSigner, StakingSignerDetail } from '../../schemas/v3/entities/staking-signers.js';

export function serializeDbStakingSigner(signer: DbStakingSigner): StakingSigner {
  return {
    signer: signer.signer,
    signer_key: signer.signer_key,
    tx_id: signer.tx_id,
    block_height: signer.block_height,
    burn_block_height: signer.burn_block_height,
  };
}

export function serializeDbStakingSignerDetail(signer: DbStakingSignerDetail): StakingSignerDetail {
  return {
    ...serializeDbStakingSigner(signer),
    transaction: {
      tx_id: signer.tx_id,
      block: {
        height: signer.block_height,
        hash: signer.block_hash,
        index_hash: signer.index_block_hash,
        time: signer.block_time,
        tx_index: signer.tx_index,
      },
      bitcoin_block: {
        height: signer.burn_block_height,
        time: signer.burn_block_time,
      },
    },
  };
}
