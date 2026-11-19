import { DEFAULT_API_PORT } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';

const base = {
  SCIA_API_TOKEN: 'a-token-long-enough-0000',
  SCIA_DATA_DIR: '/data',
  SCIA_DOWNLOAD_DIR: '/downloads',
};

describe('parseConfig', () => {
  it('reads the folders and falls back to the port the extension knows', () => {
    expect(parseConfig(base)).toEqual({
      port: DEFAULT_API_PORT,
      apiToken: base.SCIA_API_TOKEN,
      dataDir: '/data',
      downloadDir: '/downloads',
      staticDir: undefined,
      version: '0.0.0',
    });
  });

  it('takes the port, the renderer and the version it is given', () => {
    const config = parseConfig({
      ...base,
      SCIA_PORT: '0',
      SCIA_STATIC_DIR: '/renderer',
      SCIA_VERSION: '1.2.3',
    });
    expect(config.port).toBe(0);
    expect(config.staticDir).toBe('/renderer');
    expect(config.version).toBe('1.2.3');
  });

  it('refuses to start without a token, or with one too short to be a secret', () => {
    expect(() => parseConfig({ ...base, SCIA_API_TOKEN: undefined })).toThrow('SCIA_API_TOKEN');
    expect(() => parseConfig({ ...base, SCIA_API_TOKEN: 'short' })).toThrow('at least');
  });

  it('refuses a port that is not one', () => {
    expect(() => parseConfig({ ...base, SCIA_PORT: '70000' })).toThrow('SCIA_PORT');
    expect(() => parseConfig({ ...base, SCIA_PORT: 'abc' })).toThrow('SCIA_PORT');
  });

  it('refuses to start without its folders', () => {
    expect(() => parseConfig({ ...base, SCIA_DATA_DIR: '' })).toThrow('SCIA_DATA_DIR');
    expect(() => parseConfig({ ...base, SCIA_DOWNLOAD_DIR: undefined })).toThrow(
      'SCIA_DOWNLOAD_DIR',
    );
  });
});
