import { describe, expect, it } from 'vitest';
import {
  connectIntegrationSchema,
  integrationCodeSchema,
  integrationSchema,
  isIntegrationId,
  isServiceSite,
} from './integrations.ts';

const connected = {
  id: 'alldebrid',
  connected: true,
  account: { name: 'ada', premium: true, premiumUntil: '2027-06-30T12:00:00.000Z' },
  failure: null,
};

describe('integrationSchema', () => {
  it('takes a service with its account, and one with none', () => {
    expect(integrationSchema.safeParse(connected).success).toBe(true);
    expect(integrationSchema.safeParse({ ...connected, account: null }).success).toBe(true);
  });

  it('takes an instant for the day premium ends, or none, and nothing a page could not format', () => {
    const withDate = (premiumUntil: unknown) =>
      integrationSchema.safeParse({
        ...connected,
        account: { ...connected.account, premiumUntil },
      }).success;

    expect(withDate(null)).toBe(true);
    for (const refused of ['next June', '2027-06-30', '', 1_814_356_800]) {
      expect(withDate(refused), String(refused)).toBe(false);
    }
  });

  it('knows no service but the ones Scia connects to, and no failure but a service’s own', () => {
    expect(integrationSchema.safeParse({ ...connected, id: 'realdebrid' }).success).toBe(false);
    expect(integrationSchema.safeParse({ ...connected, failure: 'NETWORK' }).success).toBe(false);
    expect(integrationSchema.safeParse({ ...connected, failure: 'KEY_REFUSED' }).success).toBe(
      true,
    );
  });
});

describe('connectIntegrationSchema', () => {
  it('takes a key without what surrounded it when it was pasted', () => {
    expect(connectIntegrationSchema.parse({ apiKey: '  abc-123_XYZ\r\n' })).toEqual({
      apiKey: 'abc-123_XYZ',
    });
  });

  it('refuses what could not travel in a header as it is', () => {
    for (const apiKey of [
      '',
      '   ',
      'two words',
      'line\nbreak',
      'tab\there',
      'k\u00e9y',
      'k'.repeat(257),
    ]) {
      expect(connectIntegrationSchema.safeParse({ apiKey }).success, JSON.stringify(apiKey)).toBe(
        false,
      );
    }
    expect(connectIntegrationSchema.safeParse({ apiKey: 'k'.repeat(256) }).success).toBe(true);
  });
});

describe('isIntegrationId', () => {
  it('knows a service’s id from any other word', () => {
    expect(isIntegrationId('alldebrid')).toBe(true);
    for (const other of ['AllDebrid', 'constructor', '../alldebrid', '', 7, null, undefined]) {
      expect(isIntegrationId(other), String(other)).toBe(false);
    }
  });
});

const waiting = {
  code: 'ABCD',
  url: 'https://alldebrid.com/pin/?pin=ABCD',
  expiresAt: '2026-11-21T12:10:00.000Z',
  status: 'waiting',
  failure: null,
};

describe('integrationCodeSchema', () => {
  it('takes a code that waits, one that connected, and one that failed with why', () => {
    expect(integrationCodeSchema.safeParse(waiting).success).toBe(true);
    expect(integrationCodeSchema.safeParse({ ...waiting, status: 'connected' }).success).toBe(true);
    for (const failure of ['CODE_EXPIRED', 'KEY_REFUSED', 'SERVICE_UNAVAILABLE', 'KEY_NOT_KEPT']) {
      expect(
        integrationCodeSchema.safeParse({ ...waiting, status: 'failed', failure }).success,
        failure,
      ).toBe(true);
    }
  });

  it("refuses a failure that is not a code's, a page that is not https, and a code a page could not show as it is", () => {
    expect(integrationCodeSchema.safeParse({ ...waiting, failure: 'LINK_DOWN' }).success).toBe(
      false,
    );
    expect(
      integrationCodeSchema.safeParse({ ...waiting, url: 'http://alldebrid.com/pin/' }).success,
    ).toBe(false);
    for (const code of ['', 'AB CD', 'x'.repeat(33)]) {
      expect(integrationCodeSchema.safeParse({ ...waiting, code }).success, code).toBe(false);
    }
  });
});

describe('isServiceSite', () => {
  it("takes a page of the service's own site, over https", () => {
    expect(isServiceSite('alldebrid', 'https://alldebrid.com/pin/?pin=ABCD')).toBe(true);
    expect(isServiceSite('alldebrid', 'https://www.alldebrid.com/pin/')).toBe(true);
  });

  it('refuses another site, a name that only contains it, plain http, a port, and someone in the address', () => {
    for (const url of [
      'https://alldebrid.com.example/pin/',
      'https://notalldebrid.com/pin/',
      'https://example.com/?u=alldebrid.com',
      'http://alldebrid.com/pin/',
      'https://alldebrid.com:8443/pin/',
      'https://user@alldebrid.com/pin/',
      'javascript:alert(1)//alldebrid.com',
      'not an address',
      'https://alldebrid.com\\@evil.example/pin/',
    ]) {
      expect(isServiceSite('alldebrid', url), url).toBe(false);
    }
  });
});
