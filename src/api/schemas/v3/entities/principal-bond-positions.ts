import { Static, Type } from '@sinclair/typebox';
import { BondBalancesSchema } from './bonds.js';
import { BondIndexSchema, TransactionIdSchema } from './common.js';

export const PrincipalBondPositionStatusSchema = Type.Union([
  Type.Literal('enrolled'),
  Type.Literal('running'),
  Type.Literal('early_exit'),
  Type.Literal('unlocked'),
]);
export type PrincipalBondPositionStatus = Static<typeof PrincipalBondPositionStatusSchema>;

export const PrincipalBondPositionSchema = Type.Object({
  bond_index: BondIndexSchema,
  status: PrincipalBondPositionStatusSchema,
  active: Type.Boolean({
    description: 'Whether the position is active',
  }),
  balances: BondBalancesSchema,
  enrollment: Type.Object({
    tx_id: TransactionIdSchema,
    btc_lockup: Type.Object({
      amount: Type.String({
        description: 'The amount of BTC that is locked up for this principal',
      }),
    }),
  }),
  amount: Type.String({
    description: 'The amount of STX that is locked up for this principal',
  }),
  accrued_rewards: Type.String({
    description: "The sBTC reward sats accrued to this participant's position",
  }),
});
export type PrincipalBondPosition = Static<typeof PrincipalBondPositionSchema>;
