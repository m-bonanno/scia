import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLaunchOptions } from './launch-options.ts';

const cwd = resolve('work');

describe('parseLaunchOptions', () => {
  it('asks for nothing special on a plain launch', () => {
    expect(parseLaunchOptions(['scia.exe'], cwd)).toEqual({
      userDataDir: undefined,
      port: undefined,
      alldebridApi: undefined,
      ytDlpReleases: undefined,
      bunkr: undefined,
    });
  });

  it('passes on the address of a host that answers as Bunkr does, for the engine to judge', () => {
    expect(parseLaunchOptions(['--bunkr=http://127.0.0.1:8082'], cwd).bunkr).toBe(
      'http://127.0.0.1:8082',
    );
    expect(parseLaunchOptions(['--bunkr='], cwd).bunkr).toBeUndefined();
  });

  it('passes on the address of a host of yt-dlp’s releases, for the engine to judge', () => {
    expect(parseLaunchOptions(['--yt-dlp-releases=http://127.0.0.1:8081'], cwd).ytDlpReleases).toBe(
      'http://127.0.0.1:8081',
    );
    expect(parseLaunchOptions(['--yt-dlp-releases='], cwd).ytDlpReleases).toBeUndefined();
  });

  it('passes on the address of a simulated AllDebrid, for the engine to judge', () => {
    expect(parseLaunchOptions(['--alldebrid-api=http://127.0.0.1:8080'], cwd).alldebridApi).toBe(
      'http://127.0.0.1:8080',
    );
    expect(parseLaunchOptions(['--alldebrid-api='], cwd).alldebridApi).toBeUndefined();
  });

  it('resolves a relative profile against the folder it was launched from', () => {
    expect(parseLaunchOptions(['scia', '--user-data-dir=.dev-profile'], cwd).userDataDir).toBe(
      join(cwd, '.dev-profile'),
    );
  });

  it('keeps an absolute profile, quoted or not', () => {
    const profile = resolve('profiles', 'one');
    expect(parseLaunchOptions([`--user-data-dir=${profile}`], cwd).userDataDir).toBe(profile);
    expect(parseLaunchOptions([`--user-data-dir="${profile}"`], cwd).userDataDir).toBe(profile);
  });

  it('takes a port and refuses what is not one', () => {
    expect(parseLaunchOptions(['--port=47822'], cwd).port).toBe(47822);
    expect(parseLaunchOptions(['--port=0'], cwd).port).toBe(0);
    expect(parseLaunchOptions(['--port=99999'], cwd).port).toBeUndefined();
    expect(parseLaunchOptions(['--port=abc'], cwd).port).toBeUndefined();
    expect(parseLaunchOptions(['--port='], cwd).port).toBeUndefined();
  });
});
