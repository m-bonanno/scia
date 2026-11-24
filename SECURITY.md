# Security

## Reporting a problem

Report a security problem privately, through this repository's [private reporting](https://github.com/m-bonanno/scia/security/advisories/new) (Security → Report a vulnerability). **Never in an issue, a discussion or a pull request**: those are public.

Say what you found, which version of Scia (at the bottom of Settings), and how to see it again. Do not send a real key of a service, a token or a private link: one made up shows the problem as well.

The owner reads every report, answers on it, and fixes what it shows in a release. The advisory is published once a release carries the fix, crediting you unless you ask not to be named.

## Versions

Scia has no stable release yet: only the latest `v1.0.0-beta.N` gets fixes. Once there is a stable release, the latest stable does.

## What counts

What lets someone do through Scia what its rules say they cannot, for example:

- reach the engine's API without its token, from a web page or from another program;
- read the key of a service, the API's token or a direct link a service gave, where Scia's rules say none is kept: a log, an answer of the API, an address, or a file outside Scia's profile;
- read the key of a service from Scia's profile without the system that sealed it;
- have Scia write outside the folder of a download, or over a file;
- have Scia run a program, or an update whose signature or sum it did not check;
- have the browser extension reach more than it is allowed to.

How Scia keeps each of these is in its [architecture decisions](./docs/adr/).

Not a problem of Scia's: a site or a service that misbehaves on its own, and a file someone downloads on purpose. Scia keeps in its profile, on purpose, the extension's token and the direct links a service gave, for the next start ([ADR 0002](./docs/adr/0002-browser-extension-pairing.md), [ADR 0005](./docs/adr/0005-a-service-resolves-a-link.md)): whoever can read the profile can read those. A downloaded file carries its system's mark of having come from the network, and a program asks for a second press before it runs.
