import { Static, Type } from '@sinclair/typebox';

export const BondRegistrationSchema = Type.Object({
  bond_index: Type.Integer(),
  signer: Type.String(),
  staker: Type.String(),
  amount_ustx: Type.String(),
  sats_total: Type.String(),
  first_reward_cycle: Type.Integer(),
  unlock_burn_height: Type.Integer(),
  unlock_cycle: Type.Integer(),
  is_l1_lock: Type.Boolean(),
});
export type BondRegistration = Static<typeof BondRegistrationSchema>;
