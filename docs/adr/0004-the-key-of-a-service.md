# ADR 0004 — The key of a connected service is kept by the operating system, and reaches the engine through main

- **Status**: accepted; the PIN flow its alternatives left for later is taken up by [ADR 0013](./0013-a-key-that-arrives-by-a-code.md): a key also arrives by a code, and is kept as this ADR says
- **Date**: 2026-11-20

## Context

Scia connects to outside services, AllDebrid first (#7). A service is spoken to with a key of the person's account: whoever holds it can use that account. The owner's requirement is that the key be kept by the operating system's protected storage — never in `state.json`, never in a log.

The engine is the process that speaks to the service: it downloads, it runs under plain Node in specs and in `npm run dev`, and it never imports Electron ([ADR 0001](./0001-electron-and-a-local-engine.md)). The protected storage Scia can reach without a native module is Electron's `safeStorage`, and only main has it.

## Decision

1. **The engine holds the key in memory and is the only process that speaks to the service.** The key travels in the `Authorization` header of requests to the service's own address, and in nothing else: not in an address, not in an error, not in a log. A redirect is not followed.
2. **Between two runs the key is kept by main, sealed by the system**: Electron's `safeStorage`, in one small file per service under `userData/keys/`. On Windows the file is encrypted with a key of the profile's, which the Data Protection API seals for the person's Windows account (Chromium keeps it, sealed, in the profile's `Local State`). Nothing of a service's key is in `state.json`.
3. **The engine asks main for it on the channel that already carries `ready` and `shutdown`**: a request to read, write or remove the key of a service, and main's answer. In the engine this is a port, `KeyVault` (`apps/server/src/key-vault.ts`), with two adapters: `ParentVault` in the real app, `MemoryVault` under plain Node, where nobody keeps a key and it lasts as long as the process. Main's side is `apps/desktop/src/engine/key-vault.ts`. The engine asks before it listens, so a download that waits in the queue never starts before its service is known.
4. **Main answers only for a name that is a service's id.** The name becomes a file's name: no request of the engine's reaches another file.
5. **Where the system has nothing that protects a key, no key is kept, and the service is not connected.** On Linux without a keyring Electron seals with a password written in the program: that is not taken for protection.
6. **A key is kept only after the service accepted it, and leaves the vault before it is forgotten.** One that stayed in the vault would connect Scia again by itself at its next start. Connecting and disconnecting happen one at a time, in the engine and in main; a write the engine gave up waiting for is undone, by asking the vault to be what it was.
7. **The page hands the key to the engine once**, on a route of the app's token alone (`PUT /api/v1/integrations/:id`). No route answers a key: the page cannot read back what it sent, and the extension's token opens none of these routes ([ADR 0002](./0002-browser-extension-pairing.md)).
8. **The address a service is spoken to at is replaced only by one on this computer** (`SCIA_ALLDEBRID_API`, from the launch option `--alldebrid-api`): the simulated service of a run. The engine does not start with any other, so that no argument sends a key to another machine.

## Alternatives considered

- **Main connects the service, through the bridge** (page → main → engine). Rejected: `window.scia` would grow by members that carry a secret, against a bridge that stays tiny; and main would still have to hand the key to every engine it starts — in the environment, or by a call that races the queue.
- **The key in the engine's environment.** Rejected: a process's environment can be read by the account's other programs for as long as it runs, and connecting while the engine runs would need a second road anyway.
- **A native keychain module in the engine.** Rejected: a native module to build and ship per platform (`apps/desktop/CLAUDE.md`: none without an ADR), for what Electron already does.
- **The Data Protection API through a PowerShell process.** Rejected: a process started for every read, and a road that exists on Windows alone.
- **AllDebrid's PIN flow instead of a pasted key** (the person approves a code on AllDebrid's site and Scia receives a key). Not now: #7 asks for the key, and the flow needs main to open a browser on an address and to poll. It would change how a key arrives, not where it is kept.

## Consequences

- What protects the key is the person's account on the computer. A program running as that person can ask the system for it, as it can for the passwords a browser saves; another account, and someone who only copies the profile's folder elsewhere, cannot.
- A profile moved to another computer or account starts not connected: the key cannot be read back, the log says so, and the person connects again.
- The key is in the engine's memory while it runs, and crosses the loopback API once, in the body of the request that connects.
- An engine that main starts again asks for the key again: nothing is handed over twice by hand.
- `npm run dev` keeps no key between two runs.
- The launch option of point 8 is honoured by the installed app too: on the real profile, the address on this computer would be sent the key that profile holds. Every run that names a simulated service uses a scratch profile (`apps/desktop/CLAUDE.md`, "User data").
- A key that cannot be read for a passing reason — a main that is silent for five seconds — shows "Not connected" and stays in the vault: Scia is connected again at its next start. That is not what point 6 wants; it is rare, and the log says `key_not_read`.
- Linux is untried, as the rest of Scia there.
