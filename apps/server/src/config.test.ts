import { tmpdir } from 'node:os';
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
      alldebridApi: 'https://api.alldebrid.com',
      ytDlp: undefined,
      ytDlpUpdates: undefined,
      ytDlpReleases: 'https://github.com/yt-dlp/yt-dlp',
      bunkr: undefined,
      tempDir: tmpdir(),
    });
  });

  it('reads Bunkr at another address only when it is on this computer', () => {
    expect(parseConfig({ ...base, SCIA_BUNKR: '' }).bunkr).toBeUndefined();
    expect(parseConfig({ ...base, SCIA_BUNKR: 'http://127.0.0.1:8082' }).bunkr).toBe(
      'http://127.0.0.1:8082',
    );
    expect(parseConfig({ ...base, SCIA_BUNKR: 'http://localhost:8082/' }).bunkr).toBe(
      'http://localhost:8082',
    );
    for (const elsewhere of [
      'https://bunkr.cr',
      'http://127.0.0.1.example.com',
      'http://user@127.0.0.1:8082',
      'https://127.0.0.1:8082',
      'not an address',
    ]) {
      expect(() => parseConfig({ ...base, SCIA_BUNKR: elsewhere }), elsewhere).toThrow(
        'SCIA_BUNKR',
      );
    }
  });

  it('brings yt-dlp up to date only when main says which release it shipped and its build’s name', () => {
    const shipped = {
      ...base,
      SCIA_YT_DLP: '/tools/yt-dlp.exe',
      SCIA_YT_DLP_VERSION: '2026.10.26',
      SCIA_YT_DLP_ASSET: 'yt-dlp.exe',
    };
    expect(parseConfig(shipped).ytDlpUpdates).toEqual({
      version: '2026.10.26',
      asset: 'yt-dlp.exe',
    });
    expect(parseConfig({ ...shipped, SCIA_YT_DLP: '' }).ytDlpUpdates).toBeUndefined();
    expect(parseConfig({ ...shipped, SCIA_YT_DLP_VERSION: '' }).ytDlpUpdates).toBeUndefined();
    expect(parseConfig({ ...shipped, SCIA_YT_DLP_ASSET: '' }).ytDlpUpdates).toBeUndefined();
    expect(() => parseConfig({ ...shipped, SCIA_YT_DLP_VERSION: 'latest' })).toThrow(
      'SCIA_YT_DLP_VERSION',
    );
    expect(() => parseConfig({ ...shipped, SCIA_YT_DLP_ASSET: '../yt-dlp.exe' })).toThrow(
      'SCIA_YT_DLP_ASSET',
    );
  });

  it('takes another address for yt-dlp’s releases only when it is on this computer', () => {
    expect(
      parseConfig({ ...base, SCIA_YT_DLP_RELEASES: 'http://127.0.0.1:8080/' }).ytDlpReleases,
    ).toBe('http://127.0.0.1:8080');
    expect(() =>
      parseConfig({ ...base, SCIA_YT_DLP_RELEASES: 'https://github.com/someone/yt-dlp' }),
    ).toThrow('SCIA_YT_DLP_RELEASES');
  });

  it('reads pages with the yt-dlp it is given, and with none when it is given none', () => {
    expect(parseConfig({ ...base, SCIA_YT_DLP: '/tools/yt-dlp' }).ytDlp).toBe('/tools/yt-dlp');
    expect(parseConfig({ ...base, SCIA_YT_DLP: '' }).ytDlp).toBeUndefined();
  });

  it('takes the folder for temporary files main names, or the one it knows of itself', () => {
    expect(parseConfig({ ...base, SCIA_TEMP_DIR: '/temp' }).tempDir).toBe('/temp');
    expect(parseConfig({ ...base, SCIA_TEMP_DIR: '' }).tempDir).toBe(tmpdir());
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

  it('takes another address for AllDebrid only when it is on this computer', () => {
    expect(parseConfig({ ...base, SCIA_ALLDEBRID_API: '' }).alldebridApi).toBe(
      'https://api.alldebrid.com',
    );
    expect(parseConfig({ ...base, SCIA_ALLDEBRID_API: 'http://127.0.0.1:8080' }).alldebridApi).toBe(
      'http://127.0.0.1:8080',
    );
    expect(
      parseConfig({ ...base, SCIA_ALLDEBRID_API: 'http://localhost:8080/' }).alldebridApi,
    ).toBe('http://localhost:8080');
    for (const elsewhere of [
      'https://api.example.com',
      'http://127.0.0.1.example.com',
      'http://localhost.example.com:8080',
      'http://127.0.0.1@example.com',
      'http://key@127.0.0.1:8080',
      'https://127.0.0.1:8080',
      'file:///keys',
      'not an address',
    ]) {
      expect(() => parseConfig({ ...base, SCIA_ALLDEBRID_API: elsewhere }), elsewhere).toThrow(
        'SCIA_ALLDEBRID_API',
      );
    }
  });

  it('refuses to start without its folders', () => {
    expect(() => parseConfig({ ...base, SCIA_DATA_DIR: '' })).toThrow('SCIA_DATA_DIR');
    expect(() => parseConfig({ ...base, SCIA_DOWNLOAD_DIR: undefined })).toThrow(
      'SCIA_DOWNLOAD_DIR',
    );
  });
});
