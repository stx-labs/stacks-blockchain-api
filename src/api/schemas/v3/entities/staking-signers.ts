import { Static, Type } from '@sinclair/typebox';
import { PrincipalSchema } from './common.js';

export const StakingSignerSchema = Type.Object(
  {
    signer: PrincipalSchema,
    signer_key: Type.String({
      description: 'The registered compressed secp256k1 public key, as a `0x`-prefixed hex string',
      examples: ['0x03a0f9e1...'],
    }),
    tx_id: Type.String({ description: 'The transaction that registered this signer key' }),
    block_height: Type.Integer({
      description: 'The Stacks block height at which the signer key was registered',
    }),
    burn_block_height: Type.Integer({
      description: 'The burnchain block height at which the signer key was registered',
    }),
  },
  { title: 'StakingSigner' }
);
export type StakingSigner = Static<typeof StakingSignerSchema>;
