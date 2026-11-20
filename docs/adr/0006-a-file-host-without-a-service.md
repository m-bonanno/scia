# ADR 0006 — A file host's link with no service connected asks the service's public list

- **Status**: accepted
- **Date**: 2026-11-20

## Context

[ADR 0005](./0005-a-service-resolves-a-link.md) recognises a hoster's link by the list of hosts the connected service gives for the account, and its last consequence says what happens with no service connected: the link is fetched as it stands, and the hoster's page is saved as the file, with no word of why (#49). The roadmap (M3) and #7 ask that Scia say so, and say what to do.

With no service connected there is no account to ask. The owner decided how Scia knows such a link (20 November 2026, on #49): it asks AllDebrid for the list of the file hosts it supports, which AllDebrid gives to anyone (`GET /v4/hosts/domains`: "All `/v4/hosts/*` endpoints are public, authentication apikey is optional", its documentation, read on 20 November 2026). Read from this computer the same day, with no key: 108 domains of file hosts, beside 2,055 of sites of videos and 44 of shorteners of links.

## Decision

1. **With no service connected, `Integrations.serviceFor` reads AllDebrid's public list of file hosts** (`AllDebrid.publicDomains`): no key, no link, nothing but the request. Only `hosts` is read: `streams` and `redirectors` are sites of videos and shorteners of links, which are not file hosts and which Scia fetches as it always did.
2. **A link whose host is one of those domains, or its `www.`, fails with `SERVICE_NEEDED`** before anything is fetched, and its row names the service to connect and where. "Retry" after connecting goes through the service (ADR 0005).
3. **Only the domain itself and its `www.`, not its other subdomains**, unlike ADR 0005's point 5. A file host's page is on its own name; its other names are the servers of its files, which give a file to anyone who has the link (`downloadNNNN.mediafire.com`, for one). With a service connected, such a link is the service's to unlock or refuse; with none, a subdomain taken for the host's page would stop a download that works today. A match missed leaves the link as it was before #49; a match too many takes away a download.
4. **The list is read when first needed and every six hours**, one reading for every link that waits, as the account's list. **It is not kept between runs**: a run that cannot read it fetches links as they stand, as before #49, and asks again a minute later. The account's list is kept because, with a service connected, a link is never started on a guess (ADR 0005, point 6); with none, a link going as it stands is what Scia did until now, and keeping a second file earns nothing more.

## Alternatives considered

- **Telling a hoster's link by the page it answers with** (a page where a file was asked for): no request to AllDebrid, true of any link. Not chosen by the owner.
- **A list of file hosts shipped with Scia**: no request either, but kept by hand, and old by the next release.
- **Every subdomain, as with a service connected**: the direct links of a file host's own servers would be refused (point 3).

## Consequences

- **Scia speaks to AllDebrid for someone who has not connected it**: one request every six hours at most while links are added, with no key and no link — AllDebrid sees the address of the computer and Scia's user agent. The README says so.
- AllDebrid's list holds names that are no file host's: `example.com` and `example.net` are among its `hosts`, so a link on those names says it needs a service. They are names reserved for examples.
- A file host AllDebrid does not support is not recognised: its page is still saved as the file, as before #49.
- The sentence names AllDebrid, the one service there is; a second service changes it.
