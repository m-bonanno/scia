import { describe, expect, it } from 'vitest';
import { buildServerEnv } from './server-env.ts';

const layout = {
  serverEntry: 'server.cjs',
  rendererDir: 'renderer',
  dataDir: 'data',
  logsDir: 'logs',
  downloadDir: 'downloads',
  noticesPath: 'notices.json',
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
