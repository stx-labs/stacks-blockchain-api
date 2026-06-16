import { Static, Type } from '@sinclair/typebox';
import { BondIndexSchema, TransactionIdSchema } from './common.js';

export const PrincipalBondPositionStatusSchema = Type.Union([
  Type.Literal('enrolled'),
  Type.Literal('running'),
  Type.Literal('early_exit'),
  Type.Literal('unlocked'),
]);
export type PrincipalBondPositionStatus = Static<typeof PrincipalBondPositionStatusSchema>;

/** Lifetime sBTC reward sats earned by a staking position (accrued / claimed / outstanding). */
export const BtcRewardsSchema = Type.Object({
  accrued: Type.String({
    description: 'The lifetime sBTC reward sats accrued to this position',
  }),
  claimed: Type.String({
    description: 'The lifetime sBTC reward sats already claimed against this position',
  }),
  claimable: Type.String({
    description: 'The sBTC reward sats currently claimable (accrued minus claimed)',
  }),
});
export type BtcRewards = Static<typeof BtcRewardsSchema>;

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
    btc: BtcRewardsSchema,
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

/**
 * A principal's pox-5 STX-staking position: the uSTX it currently has locked in
 * STX staking, and the sBTC rewards that staking has earned. Rewards persist
 * after unstaking until claimed, so `locked` can be `"0"` while rewards remain.
 */
export const PrincipalStxStakingPositionSchema = Type.Object({
  locked: Type.String({
    description: 'The amount of uSTX currently locked in pox-5 STX staking',
  }),
  rewards: Type.Object({
    btc: BtcRewardsSchema,
  }),
});
export type PrincipalStxStakingPosition = Static<typeof PrincipalStxStakingPositionSchema>;

/** A principal's full staking picture: its bond positions plus its STX-staking position. */
export const PrincipalStakingBalancesSchema = Type.Object({
  bonds: Type.Array(PrincipalBondPositionSchema),
  stx: PrincipalStxStakingPositionSchema,
});
export type PrincipalStakingBalances = Static<typeof PrincipalStakingBalancesSchema>;
