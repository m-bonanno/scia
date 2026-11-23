import { ApiErrorCode } from '@scia/contracts';
import { BundleFailure } from '@scia/core';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api.ts';
import {
  accountMagnetMessage,
  addRefusedMessage,
  bundleActionMessage,
  bundleFailureMessage,
  errorMessage,
  magnetActionMessage,
  settingNotChangedMessage,
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

  // INVALID_REQUEST answers a choice of files, a setting and a folder as well as links (#142).
  it('names no links for a refusal of what any request carried', () => {
    expect(errorMessage(new ApiError(400, ApiErrorCode.InvalidRequest, 'x'))).toBe(
      'Scia could not complete the operation. Try again.',
    );
  });
});

describe('what the engine refused of an add', () => {
  it('names what was sent: links, or magnets', () => {
    expect(addRefusedMessage('links')).toBe('Scia’s engine did not take the links you pasted.');
    expect(addRefusedMessage('magnets')).toBe('Scia’s engine did not take the magnets you pasted.');
  });
});

describe('a change in Settings not kept', () => {
  const failure = new ApiError(400, ApiErrorCode.InvalidRequest, 'x');

  it('names the setting whose change was lost, for every cause', () => {
    expect(settingNotChangedMessage('maxConcurrentDownloads', failure)).toBe(
      'Scia could not change the number of simultaneous downloads. Try again.',
    );
    expect(settingNotChangedMessage('connectionsPerDownload', new TypeError('offline'))).toBe(
      'Scia could not change the number of connections per download. Try again.',
    );
    expect(settingNotChangedMessage('speedLimitBytesPerSecond', failure)).toBe(
      'Scia could not change the speed limit. Try again.',
    );
    expect(settingNotChangedMessage('theme', failure)).toBe(
      'Scia could not change the theme. Try again.',
    );
    expect(settingNotChangedMessage('betaUpdates', failure)).toBe(
      'Scia could not change whether it updates to beta versions. Try again.',
    );
    expect(settingNotChangedMessage('watchClipboard', failure)).toBe(
      'Scia could not change whether it takes links from the clipboard. Try again.',
    );
  });

  // Trying again does not mend a window the engine does not know: the remedy is its own.
  it('says what a window the engine does not recognize says', () => {
    const unknown = new ApiError(401, ApiErrorCode.Unauthorized, 'x');
    expect(settingNotChangedMessage('theme', unknown)).toBe(errorMessage(unknown));
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
