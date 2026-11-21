import { describe, expect, it } from 'vitest';
import { ApiError } from './api.ts';
import { accountMagnetMessage, errorMessage, magnetActionMessage } from './messages.ts';

describe('the sentence of a code', () => {
  it('finds no sentence in a name every object has: a code is a word from outside', () => {
    for (const code of ['constructor', 'toString', '__proto__']) {
      const error = new ApiError(400, code, 'x');
      const fallback = 'Scia could not complete the operation. Try again.';
      expect(errorMessage(error), code).toBe(fallback);
      expect(magnetActionMessage(error), code).toBe(fallback);
      expect(accountMagnetMessage(error), code).toBe(fallback);
    }
  });
});
