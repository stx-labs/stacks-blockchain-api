import { Static, Type } from '@sinclair/typebox';

export const PrincipalStakingBalancesResponseSchema = Type.Object({
  bonds: Type.String({
    description: 'The total amount of STX that is locked up for this principal',
  }),
  stx: Type.String({
    description: 'The total amount of STX that is locked up for this principal',
  }),
});
export type PrincipalStakingBalancesResponse = Static<
  typeof PrincipalStakingBalancesResponseSchema
>;
