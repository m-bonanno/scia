import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRuntimeLayout } from './runtime-layout.ts';

const input = {
  isPackaged: false,
  resourcesPath: join('install', 'resources'),
  appRoot: join('repo', 'apps', 'desktop'),
  userDataDir: join('profile', 'Scia'),
  downloadsDir: join('home', 'Downloads'),
  scratchProfile: false,
  platform: 'win32' as const,
};

describe('resolveRuntimeLayout', () => {
  it('finds the engine and the renderer beside the app in a packaged build', () => {
    const layout = resolveRuntimeLayout({ ...input, isPackaged: true });
    expect(layout.serverEntry).toBe(join('install', 'resources', 'server', 'server.cjs'));
    expect(layout.rendererDir).toBe(join('install', 'resources', 'renderer'));
  });

  it('finds them in their workspaces during development', () => {
    const layout = resolveRuntimeLayout(input);
    expect(layout.serverEntry).toBe(join('repo', 'apps', 'server', 'dist', 'server.cjs'));
    expect(layout.rendererDir).toBe(join('repo', 'apps', 'renderer', 'dist'));
  });

  it('finds the reader of pages that was shipped for this system, and none where none is', () => {
    expect(resolveRuntimeLayout({ ...input, isPackaged: true }).ytDlp).toBe(
      join('install', 'resources', 'tools', 'yt-dlp.exe'),
    );
    expect(resolveRuntimeLayout(input).ytDlp).toBe(
      join('repo', 'apps', 'desktop', 'tools', 'win', 'yt-dlp.exe'),
    );
    expect(resolveRuntimeLayout({ ...input, isPackaged: true, platform: 'linux' }).ytDlp).toBe(
      join('install', 'resources', 'tools', 'yt-dlp'),
    );
    expect(resolveRuntimeLayout({ ...input, platform: 'darwin' }).ytDlp).toBeUndefined();
  });

  it('keeps the engine’s files and the logs in the profile, never beside the executable', () => {
    const layout = resolveRuntimeLayout({ ...input, isPackaged: true });
    expect(layout.dataDir).toBe(join('profile', 'Scia', 'engine'));
    expect(layout.logsDir).toBe(join('profile', 'Scia', 'logs'));
    expect(layout.noticesPath).toBe(join('profile', 'Scia', 'notices.json'));
    expect(layout.keysDir).toBe(join('profile', 'Scia', 'keys'));
  });

  it('downloads into the system folder, or into the profile of a scratch run', () => {
    expect(resolveRuntimeLayout(input).downloadDir).toBe(join('home', 'Downloads'));
    expect(resolveRuntimeLayout({ ...input, scratchProfile: true }).downloadDir).toBe(
      join('profile', 'Scia', 'downloads'),
    );
  });
});
