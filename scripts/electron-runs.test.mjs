import { describe, expect, it } from 'vitest';
import { mayStartElectron } from './electron-runs.mjs';

describe('mayStartElectron', () => {
  it('lets CI start the app', () => {
    expect(mayStartElectron({ CI: 'true' })).toBe(true);
  });

  it('lets a person start it by hand, by saying so', () => {
    expect(mayStartElectron({ SCIA_E2E_LOCAL: '1' })).toBe(true);
  });

  it('refuses anywhere else: the owner works on this machine (#171, #218)', () => {
    expect(mayStartElectron({})).toBe(false);
    expect(mayStartElectron({ CI: 'false', SCIA_E2E_LOCAL: '0' })).toBe(false);
  });
});
