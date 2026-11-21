# ADR 0016 — The installer refuses to install a version older than the one installed

- **Status**: accepted
- **Date**: 2026-11-21

## Context

The updater never offers a version older than the one installed: `allowDowngrade` stays off ([ADR 0007](./0007-automatic-updates.md), decision 3). The installer run by hand had no such rule. An old installer left in Downloads, run over a newer Scia, replaced it without a word (#172).

The owner decided (21 November 2026, on #172), each time choosing the recommended option of a multiple-choice question:

1. **The installer refuses to install a version older than the one installed**, and says so: "Scia 1.0.0-beta.20 is already installed, and it is newer than this installer's 1.0.0-beta.17. To install 1.0.0-beta.17, uninstall Scia first: your downloads and settings are kept." The versions are written in full, as Windows lists the installed app.
2. **There is no option to force it.** Whoever wants to go back uninstalls Scia first; the uninstaller keeps the app's data (`deleteAppDataOnUninstall: false`).
3. **The same version installs again**, as a repair: only an older one is refused.
4. **A build made here, at `0.0.0`, is refused like any older version.** No exception: a build made here is tried unpacked ([`testing.md`](../development/testing.md), "The installer's smoke test"), and the CI smoke test installs on a clean runner.

What follows was read on 21 November 2026 in electron-builder 26.18.0, its NSIS templates and makensis 3.0.4.1, and tried with installers built from this repository.

## Decision

1. **The check is an include of electron-builder's NSIS installer**: `apps/desktop/build/installer.nsh`, named by `nsis.include` in `electron-builder.yml`. Its macro `customInit` runs in the installer's `.onInit`, after electron-builder has chosen the per-user install and read where Scia is (`initMultiUser`), and before anything is written, closed or uninstalled: the running Scia is ended, and the old version uninstalled, only in the install section, which a refusal never reaches.
2. **The version installed is the `DisplayVersion` of the uninstaller's registry key** (`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<the app's GUID>`), which electron-builder's installer writes, with its full version, at every install (`registryAddInstallInfo` in its templates). No key, an empty value or a value that is not a semantic version installs: nothing says that what is there is newer.
3. **Versions are compared as semantic versions** (semver.org, section 11), in NSIS: the three numbers by value; then a version with a prerelease is older than the same version without one (`1.0.0-beta.20` < `1.0.0`); then the prerelease identifiers one by one — numbers by value and below words, words in ASCII order (Windows' `CompareStringOrdinal`), a shorter list below a longer one with the same start (`1.0.0-beta.20` < `1.0.0-beta.20.local`). Build metadata is ignored in the order. A version is read only as semver writes one: three numbers, and identifiers after `-` and `+` that are not empty and are made of `[0-9A-Za-z-]`, a prerelease identifier of digits being a number with no leading zero. A number past 2,147,483,647 is not read as one — NSIS counts in 32 bits. A value that breaks any of these is read as no version, and installs (decision 2). The text reaches the System plug-in's calls by the stack, never inside them, so a quote in the registry's value cannot change their parameters.
4. **A refusal is a message box, then the exit code 1638**, Windows' `ERROR_PRODUCT_VERSION` ("Another version of this product is already installed"). With `/S` the box is not shown (`/SD IDOK`) and only the exit code says it. The uninstaller is built from the same script and carries none of it (`!ifndef BUILD_UNINSTALLER`).
5. **The comparison, the refusal's words and `customInit` are held by specs that run them in NSIS**: `apps/desktop/build/installer.int.test.ts` compiles two small programs around the include with the makensis electron-builder packs with. One answers, for each pair of versions — semver.org's own example of precedence among them — their order, the words of a refusal and whether the stack, which the include shares with electron-builder's script, is left as it was. The other is an installer of its own version whose `.onInit` is the include's `customInit`, reading a registry key of the spec's: run silently over a newer version it ends with 1638 before its install section, and over the same version or none it installs. On Windows only: the programs are Windows programs. **The refusal of the real installer is held by the installer's smoke test**, in CI: after the install it writes a newer `DisplayVersion` into the key, runs the installer silently, expects 1638 and the folder and both keys as they were, puts the version back, and installs the same version again.

## Alternatives considered

- **A switch to force the downgrade** (`/force`, or a button in the box): rejected by the owner (decision 2). Uninstalling first does the same, keeps the data, and cannot happen by accident.
- **Refuse the same version too**: a repair would then need an uninstall first (decision 3).
- **Let `0.0.0` install over anything**: a special case in the installer for a build nobody installs on a person's computer (decision 4).
- **Compare in a plug-in or a program shipped inside the installer**: a native piece in the installer, for a few functions of NSIS that a spec runs as the installer does.
- **Read the version from the installed `Scia.exe`'s file version**: Windows' four numbers carry no prerelease, and `1.0.0-beta.17` and `1.0.0-beta.20` would be equal.

## Consequences

- **An older installer run over a newer Scia stops at once, before it ends a running Scia**: the person sees the box and their Scia keeps running. Run silently, it ends with 1638 and has done nothing.
- **Going back to an earlier version takes an uninstall first.** The downloads, the history, the settings and the keys of the connected services are kept: they live in `%APPDATA%\Scia`, which the uninstaller leaves.
- **The updater is unchanged.** It never offers an older version (ADR 0007), and the installer it starts is never refused — the same version cannot be offered either, since electron-updater offers only a newer one. Main does not see the installer's exit code: a restart to update (ADR 0015) refused by the installer would leave Scia closed, `Updates.finish` deciding its relaunch from electron-updater's answer only. That needs a registry that says a newer version than the Scia that runs, which no road of Scia's writes.
- **A developer who installs a build made here over a release is refused**, and uninstalls first; the packaged app is tried unpacked, as `testing.md` already says.
- **The CI job "Windows tests, build" fetches makensis** for the spec, at the version and checksum electron-builder pins, and keeps it in a cache of its own.
- **Linux is untouched**: an AppImage or a `.deb` has no installer of this kind, and the Linux packages are not built (#73).
