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
      }),
    ).toEqual({
      SCIA_API_TOKEN: 'token',
      SCIA_PORT: '47821',
      SCIA_DATA_DIR: 'data',
      SCIA_DOWNLOAD_DIR: 'downloads',
      SCIA_STATIC_DIR: 'renderer',
      SCIA_VERSION: '1.0.0',
    });
  });

  it('names another address for AllDebrid only when the launch gave one', () => {
    const env = buildServerEnv({
      layout,
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: undefined,
      alldebridApi: 'http://127.0.0.1:8080',
    });
    expect(env.SCIA_ALLDEBRID_API).toBe('http://127.0.0.1:8080');
  });

  it('names the reader of pages only where one was shipped', () => {
    const env = buildServerEnv({
      layout: { ...layout, ytDlp: 'tools/yt-dlp.exe' },
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: undefined,
    });
    expect(env.SCIA_YT_DLP).toBe('tools/yt-dlp.exe');
  });

  it('keeps SystemRoot on Windows, where the network stack needs it', () => {
    const env = buildServerEnv({
      layout,
      apiToken: 'token',
      port: 0,
      version: '1.0.0',
      systemRoot: 'C:\\Windows',
    });
    expect(env.SystemRoot).toBe('C:\\Windows');
  });
});
