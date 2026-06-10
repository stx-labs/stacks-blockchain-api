import { Static, Type } from '@sinclair/typebox';

export const BondLockupTxSchema = Type.Object(
  {
    txid: Type.String({
      description: 'Reversed (big-endian) Bitcoin txid as a 0x-prefixed hex string',
    }),
    output_index: Type.String({ description: 'The output index of the proven L1 lockup' }),
  },
  { title: 'BondLockupTx' }
);

export const BondBtcLockupSchema = Type.Object(
  {
    type: Type.String({
      description: "'l1' for a proven Bitcoin L1 lockup, 'l2' for an sBTC lockup",
    }),
    txs: Type.Array(BondLockupTxSchema, {
      description: 'The proven L1 lockup outputs; empty for an sBTC lockup',
    }),
  },
  { title: 'BondBtcLockup' }
);

export const BondRegistrationSchema = Type.Object({
  bond_index: Type.Integer(),
  signer: Type.String(),
  staker: Type.String(),
  amount_ustx: Type.String(),
  sats_total: Type.String(),
  first_reward_cycle: Type.Integer(),
  unlock_burn_height: Type.Integer(),
  unlock_cycle: Type.Integer(),
  btc_lockup: BondBtcLockupSchema,
});
export type BondRegistration = Static<typeof BondRegistrationSchema>;
