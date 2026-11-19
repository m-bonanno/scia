import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLaunchOptions } from './launch-options.ts';

const cwd = resolve('work');

describe('parseLaunchOptions', () => {
  it('asks for nothing special on a plain launch', () => {
    expect(parseLaunchOptions(['scia.exe'], cwd)).toEqual({
      userDataDir: undefined,
      port: undefined,
    });
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
