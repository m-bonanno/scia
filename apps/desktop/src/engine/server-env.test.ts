import { ENGINE_THREADPOOL_SIZE, SETTINGS_LIMITS } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { buildServerEnv } from './server-env.ts';

const layout = {
  serverEntry: 'server.cjs',
  rendererDir: 'renderer',
  dataDir: 'data',
  logsDir: 'logs',
  downloadDir: 'downloads',
  noticesPath: 'notices.json',
  keysDir: 'keys',
  ytDlp: undefined,
};

describe('buildServerEnv', () => {
  it('gives the engine exactly what it needs and nothing inherited', () => {
    expect(
      buildServerEnv({
        layout,
        apiToken: 'token',
        port: 47821,
        version: '1.0.0',
        systemRoot: undefined,
        tempDir: 'temp',
      }),
    ).toEqual({
      SCIA_API_TOKEN: 'token',
      SCIA_PORT: '47821',
      SCIA_DATA_DIR: 'data',
      SCIA_DOWNLOAD_DIR: 'downloads',
      SCIA_STATIC_DIR: 'renderer',
      SCIA_VERSION: '1.0.0',
      SCIA_TEMP_DIR: 'temp',
      UV_THREADPOOL_SIZE: String(ENGINE_THREADPOOL_SIZE),
    });
  });

  it('gives the engine a thread for every write it can have at once, and some to spare (#182)', () => {
    const env = buildServerEnv({
      layout,
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: undefined,
      tempDir: 'temp',
    });
    const writesAtOnce =
      SETTINGS_LIMITS.maxConcurrentDownloads.max * SETTINGS_LIMITS.connectionsPerDownload.max;
    expect(Number(env.UV_THREADPOOL_SIZE)).toBeGreaterThan(writesAtOnce);
    // libuv takes no more.
    expect(Number(env.UV_THREADPOOL_SIZE)).toBeLessThanOrEqual(1024);
  });

  it('names another address for AllDebrid only when the launch gave one', () => {
    const env = buildServerEnv({
      layout,
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: undefined,
      tempDir: 'temp',
      alldebridApi: 'http://127.0.0.1:8080',
    });
    expect(env.SCIA_ALLDEBRID_API).toBe('http://127.0.0.1:8080');
    expect(env).not.toHaveProperty('SCIA_BUNKR');
  });

  it('names another address for Bunkr only when the launch gave one', () => {
    const env = buildServerEnv({
      layout,
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: undefined,
      tempDir: 'temp',
      bunkr: 'http://127.0.0.1:8082',
    });
    expect(env.SCIA_BUNKR).toBe('http://127.0.0.1:8082');
  });

  it('names the reader of pages only where one was shipped, with its release and its build’s name', () => {
    const env = buildServerEnv({
      layout: {
        ...layout,
        ytDlp: { path: 'tools/yt-dlp.exe', version: '2026.10.26', asset: 'yt-dlp.exe' },
      },
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: undefined,
      tempDir: 'temp',
    });
    expect(env.SCIA_YT_DLP).toBe('tools/yt-dlp.exe');
    expect(env.SCIA_YT_DLP_VERSION).toBe('2026.10.26');
    expect(env.SCIA_YT_DLP_ASSET).toBe('yt-dlp.exe');
  });

  it('names another host of yt-dlp’s releases only when the launch gave one', () => {
    const env = buildServerEnv({
      layout,
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: undefined,
      tempDir: 'temp',
      ytDlpReleases: 'http://127.0.0.1:8081',
    });
    expect(env.SCIA_YT_DLP_RELEASES).toBe('http://127.0.0.1:8081');
  });

  it('keeps SystemRoot on Windows, where the network stack needs it', () => {
    const env = buildServerEnv({
      layout,
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: 'C:\\Windows',
      tempDir: 'temp',
    });
    expect(env.SystemRoot).toBe('C:\\Windows');
  });
});
