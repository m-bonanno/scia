// Why a service Scia is connected to did not do what it was asked. The person reads the text
// the renderer maps the code to.
export const ServiceFailure = {
  // The service does not know the key, or no longer accepts it.
  KeyRefused: 'KEY_REFUSED',
  // The service refuses the key from this network or this country.
  KeyBlocked: 'KEY_BLOCKED',
  AccountBanned: 'ACCOUNT_BANNED',
  // It did not answer, or said it cannot right now, or said something Scia does not understand.
  Unavailable: 'SERVICE_UNAVAILABLE',
} as const;
export type ServiceFailure = (typeof ServiceFailure)[keyof typeof ServiceFailure];
