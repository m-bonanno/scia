import { ApiErrorCode } from '@scia/contracts';
import { BundleFailure } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api.ts';
import {
  accountMagnetMessage,
  bundleActionMessage,
  bundleFailureMessage,
  errorMessage,
  magnetActionMessage,
} from './messages.ts';

describe('the sentence of a code', () => {
  it('finds no sentence in a name every object has: a code is a word from outside', () => {
    for (const code of ['constructor', 'toString', '__proto__']) {
      const error = new ApiError(400, code, 'x');
      const fallback = 'Scia could not complete the operation. Try again.';
      expect(errorMessage(error), code).toBe(fallback);
      expect(magnetActionMessage(error), code).toBe(fallback);
      expect(accountMagnetMessage(error), code).toBe(fallback);
      expect(bundleActionMessage(error, 'retry'), code).toBe(fallback);
    }
  });
});

describe('what a link that opens into several files says', () => {
  it('gives every reason it gave no files a sentence of its own', () => {
    const sentences = Object.values(BundleFailure).map((failure) => bundleFailureMessage(failure));
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('names the service to connect when none is', () => {
    expect(bundleFailureMessage(BundleFailure.NeedsService)).toBe(
      'This link opens into several files through AllDebrid. Connect AllDebrid in Settings, then try again.',
    );
  });

  it('says a press was refused because the link moved on meanwhile, in its own words', () => {
    expect(bundleActionMessage(new ApiError(404, ApiErrorCode.NotFound, 'x'), 'start')).toBe(
      'This link is no longer in the list.',
    );
    expect(bundleActionMessage(new ApiError(409, ApiErrorCode.Conflict, 'x'), 'retry')).toBe(
      'This link is already being opened again.',
    );
    // Starting files of a link not waiting for a choice has no cause a person can mend.
    expect(bundleActionMessage(new ApiError(409, ApiErrorCode.Conflict, 'x'), 'start')).toBe(
      errorMessage(new ApiError(409, ApiErrorCode.Conflict, 'x')),
    );
  });
});
