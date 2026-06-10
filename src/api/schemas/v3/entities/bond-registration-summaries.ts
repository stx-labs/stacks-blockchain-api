import { Static, Type } from '@sinclair/typebox';
import { bondRegistrationBaseProperties } from './bond-registrations.js';

/** The lockup type without the (potentially large) list of proven L1 outputs. */
export const BondBtcLockupSummarySchema = Type.Object(
  {
    type: Type.String({
      description: "'l1' for a proven Bitcoin L1 lockup, 'l2' for an sBTC lockup",
    }),
  },
  { title: 'BondBtcLockupSummary' }
);

/**
 * A bond registration without the full list of L1 lockup transactions. Used by
 * the bond registrations list endpoint; the proven L1 outputs are available on
 * the per-principal registration endpoint.
 */
export const BondRegistrationSummarySchema = Type.Object(
  {
    ...bondRegistrationBaseProperties,
    btc_lockup: BondBtcLockupSummarySchema,
  },
  { title: 'BondRegistrationSummary' }
);
export type BondRegistrationSummary = Static<typeof BondRegistrationSummarySchema>;
