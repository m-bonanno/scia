import { describe, expect, it } from 'vitest';
import { failureCode } from './failure-code.ts';

describe('failureCode', () => {
  it('says the system’s code of a refusal, never its message, which names the profile’s path', () => {
    const refused = Object.assign(
      new Error(
        "EPERM: operation not permitted, rename 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\theme.json.tmp' -> 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\theme.json'",
      ),
      { code: 'EPERM', syscall: 'rename' },
    );

    expect(failureCode(refused)).toBe('EPERM');
  });

  it('says the kind of an error that has no code', () => {
    expect(failureCode(new TypeError('cannot write C:\\Users\\ada'))).toBe('TypeError');
  });

  it('says nothing more of something thrown that is no error', () => {
    expect(failureCode('C:\\Users\\ada')).toBe('unknown');
  });
});
