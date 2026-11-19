import { ApiErrorCode } from '@scia/contracts';
import { ApiError } from './api.ts';

// Errors: the fact, then the remedy. No blame, no "Oops".
const BY_CODE: Readonly<Record<string, string>> = {
  [ApiErrorCode.InvalidRequest]: 'No valid http or https addresses in what you entered.',
  [ApiErrorCode.NotFound]: 'This download is no longer in the list.',
  [ApiErrorCode.Conflict]: 'The download has already changed state. Try again in a moment.',
  [ApiErrorCode.Unauthorized]:
    'Scia does not recognise this window. Close the app and open it again.',
};

export const ENGINE_UNREACHABLE = 'Scia’s engine is not responding. Trying again…';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return BY_CODE[error.code] ?? 'Scia could not complete the operation. Try again.';
  }
  return ENGINE_UNREACHABLE;
}
