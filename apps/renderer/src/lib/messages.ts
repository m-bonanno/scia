import { ApiErrorCode } from '@scia/contracts';
import { ApiError } from './api.ts';

// Errors: the fact, then the remedy. No blame, no "Oops".
const BY_CODE: Readonly<Record<string, string>> = {
  [ApiErrorCode.InvalidRequest]: 'No http or https links in what you pasted.',
  [ApiErrorCode.NotFound]: 'This download is no longer in the list.',
  [ApiErrorCode.Conflict]: 'The download has already changed state. Try again in a moment.',
  [ApiErrorCode.Unauthorized]:
    'Scia does not recognize this window. Close the app and open it again.',
};

export const ENGINE_UNREACHABLE = 'Scia’s engine is not responding. Trying again…';

// Main says only that it failed. The engine being silent is the rare cause; a file that is no
// longer where it was downloaded is the common one.
export const FILE_NOT_OPENED = 'Scia could not open the file. It may have been moved or deleted.';

// Said only when main answers that the engine refused the folder the person chose: one it
// cannot make, or cannot write to. Any other failure of that ask is not about a folder.
export const FOLDER_REFUSED =
  'Scia could not use the folder you chose. Choose one it can write to.';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return BY_CODE[error.code] ?? 'Scia could not complete the operation. Try again.';
  }
  return ENGINE_UNREACHABLE;
}
