import { describe, expect, it } from 'vitest';
import { connectIntegrationSchema, integrationSchema, isIntegrationId } from './integrations.ts';

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
      'kéy',
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
