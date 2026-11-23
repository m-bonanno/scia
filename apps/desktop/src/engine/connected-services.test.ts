import { type CodeConnectFailed, CodeConnectFailure, IntegrationId } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import {
  codeFailedNotice,
  connectedNotice,
  NewCodeFailure,
  NewlyConnected,
} from './connected-services.ts';

describe('NewlyConnected', () => {
  it('says nothing of a service already connected when it first looked', () => {
    expect(new NewlyConnected().seen([IntegrationId.AllDebrid])).toEqual([]);
  });

  it('names a service once, when it is connected after a look that did not have it', () => {
    const newly = new NewlyConnected();
    newly.seen([]);

    expect(newly.seen([IntegrationId.AllDebrid])).toEqual([IntegrationId.AllDebrid]);
    expect(newly.seen([IntegrationId.AllDebrid])).toEqual([]);
  });

  it('names it again when it is connected again after it was let go', () => {
    const newly = new NewlyConnected();
    newly.seen([IntegrationId.AllDebrid]);
    expect(newly.seen([])).toEqual([]);

    expect(newly.seen([IntegrationId.AllDebrid])).toEqual([IntegrationId.AllDebrid]);
  });
});

describe('connectedNotice', () => {
  it('says which service is connected, and what goes through it from now on', () => {
    expect(connectedNotice(IntegrationId.AllDebrid)).toEqual({
      title: 'AllDebrid is connected',
      body: 'Links of file hosts and magnets now go through your account.',
    });
  });
});

const failed = (failure: CodeConnectFailure, at: string): CodeConnectFailed => ({
  service: IntegrationId.AllDebrid,
  failure,
  at,
});

describe('NewCodeFailure', () => {
  it('says nothing of a failure the engine held when it first looked', () => {
    expect(
      new NewCodeFailure().seen(failed(CodeConnectFailure.KeyRefused, '2026-11-23T20:00:00.000Z')),
    ).toBeUndefined();
  });

  it('names a failure once, and the next one even when it is the same refusal', () => {
    const newly = new NewCodeFailure();
    newly.seen(null);
    const first = failed(CodeConnectFailure.KeyRefused, '2026-11-23T20:00:00.000Z');
    const second = failed(CodeConnectFailure.KeyRefused, '2026-11-23T20:05:00.000Z');

    expect(newly.seen(first)).toEqual(first);
    expect(newly.seen(first)).toBeUndefined();
    expect(newly.seen(second)).toEqual(second);
  });

  it('names nothing while the engine holds none', () => {
    const newly = new NewCodeFailure();
    newly.seen(null);

    expect(newly.seen(null)).toBeUndefined();
  });
});

describe('codeFailedNotice', () => {
  it('says the service could not be connected, and why, for every refusal of a confirmed code', () => {
    const at = '2026-11-23T20:00:00.000Z';
    const bodies = Object.values(CodeConnectFailure).map(
      (failure) => codeFailedNotice(failed(failure, at)).body,
    );

    expect(codeFailedNotice(failed(CodeConnectFailure.KeyRefused, at))).toEqual({
      title: 'AllDebrid could not be connected',
      body: 'AllDebrid did not accept the key it gave for the code. In Settings, get a new code.',
    });
    expect(bodies).toEqual([
      'AllDebrid did not accept the key it gave for the code. In Settings, get a new code.',
      'AllDebrid is blocking the key from here. Confirm its email about a new sign-in, or check your network, then get a new code in Settings.',
      'AllDebrid says this account is banned.',
      'AllDebrid does not serve this network: it refuses servers and some VPNs. Connect from another network, then get a new code in Settings.',
      'Scia could not finish connecting with AllDebrid. In Settings, get a new code.',
      'Scia could not keep the key safely on this computer. Nothing was connected.',
    ]);
  });
});
