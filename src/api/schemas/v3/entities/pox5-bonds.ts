import { Static, Type } from '@sinclair/typebox';

export const Pox5BondSummarySchema = Type.Object({
  tx_id: Type.String(),
  index: Type.Integer(),
  yield_rate: Type.Integer({ description: 'The target yield rate (APY) in basis points' }),
  stx_value_ratio: Type.Integer({
    description:
      'This is a representation of the STXBTC price. The value represents "uSTX per 100 sats"',
  }),
  minimum_stx_ratio: Type.Integer({
    description:
      'The amount of STX that must be locked relative to BTC, in equal-valued terms (ie in USD terms). This value is represented in basis points.',
  }),
});
export type Pox5BondSummary = Static<typeof Pox5BondSummarySchema>;

export const Pox5BondAllowlistSchema = Type.Object({
  staker: Type.String(),
  max_sats: Type.String(),
});
export type Pox5BondAllowlist = Static<typeof Pox5BondAllowlistSchema>;

export const Pox5BondSchema = Type.Composite([
  Pox5BondSummarySchema,
  Type.Object({
    early_unlock_signers: Type.String(),
  }),
]);
export type Pox5Bond = Static<typeof Pox5BondSchema>;
