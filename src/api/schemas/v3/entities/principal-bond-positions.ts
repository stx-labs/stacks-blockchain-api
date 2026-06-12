import { Static, Type } from '@sinclair/typebox';
import { BondIndexSchema, TransactionIdSchema } from './common.js';

export const PrincipalBondPositionStatusSchema = Type.Union([
  Type.Literal('enrolled'),
  Type.Literal('running'),
  Type.Literal('early_exit'),
  Type.Literal('unlocked'),
]);
export type PrincipalBondPositionStatus = Static<typeof PrincipalBondPositionStatusSchema>;

export const PrincipalBondPositionBalancesSchema = Type.Object({
  locked: Type.Object({
    btc: Type.String({
      description: 'The amount of BTC that is locked up for this position',
    }),
    stx: Type.String({
      description: 'The amount of STX that is locked up for this position',
    }),
  }),
  rewards: Type.Object({
    btc: Type.Object({
      accrued: Type.String({
        description: 'The lifetime sBTC reward sats accrued to this position',
      }),
      claimed: Type.String({
        description: 'The lifetime sBTC reward sats already claimed against this position',
      }),
      claimable: Type.String({
        description: 'The sBTC reward sats currently claimable (accrued minus claimed)',
      }),
    }),
  }),
});
export type PrincipalBondPositionBalances = Static<typeof PrincipalBondPositionBalancesSchema>;

export const PrincipalBondPositionSchema = Type.Object({
  bond_index: BondIndexSchema,
  status: PrincipalBondPositionStatusSchema,
  active: Type.Boolean({
    description: 'Whether the position is active',
  }),
  balances: PrincipalBondPositionBalancesSchema,
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
});
export type PrincipalBondPosition = Static<typeof PrincipalBondPositionSchema>;
