import { IntegrationId } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { connectedNotice, NewlyConnected } from './connected-services.ts';

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
      body: 'Links of file hosts and magnets now download through your account.',
    });
  });
});
