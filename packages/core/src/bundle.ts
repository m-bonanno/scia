import { ServiceFailure, UnlockFailure } from './service.ts';

// Where a link that opens into several files is (#181), from the moment it is added to the moment
// the person starts the files they chose: then it leaves the list, and those files are downloads.
export const BundleStatus = {
  // The service is being asked what files are behind it.
  Opening: 'opening',
  // Its files are listed, and wait for the person to choose.
  Choosing: 'choosing',
  Failed: 'failed',
} as const;
export type BundleStatus = (typeof BundleStatus)[keyof typeof BundleStatus];

// Why a link that opens into several files gave none to choose from. The person reads the text the
// renderer maps the code to.
export const BundleFailure = {
  // The service does not open links of this site, or not this one.
  Refused: 'BUNDLE_REFUSED',
  // The service found nothing behind it, or nothing it can get.
  Empty: 'BUNDLE_EMPTY',
  // More files than Scia lists to choose from.
  TooMany: 'BUNDLE_TOO_MANY',
  // A key it refuses, a network it does not serve, an account that is not premium, no service
  // connected, a service that cannot be asked.
  ...ServiceFailure,
  NotPremium: UnlockFailure.NotPremium,
  NeedsService: UnlockFailure.NeedsService,
} as const;
export type BundleFailure = (typeof BundleFailure)[keyof typeof BundleFailure];
