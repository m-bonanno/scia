import { mkdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type FolderServer, startFolderServer } from './folder-server.ts';
import { scratchFolder } from './scratch.ts';

// The request target is sent as written: `fetch` would resolve its `..` before sending it.
function ask(server: FolderServer, target: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    request({ hostname, port, path: target }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
      });
    })
      .on('error', reject)
      .end();
  });
}

describe('startFolderServer', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function serving(): Promise<FolderServer> {
    const scratch = await scratchFolder();
    cleanups.push(() => scratch.remove());
    const root = join(scratch.path, 'site');
    await mkdir(root);
    await writeFile(join(root, 'piece.ts'), 'a piece');
    await writeFile(join(scratch.path, 'secret.txt'), 'beside the folder');
    const server = await startFolderServer({ root });
    cleanups.push(() => server.close());
    return server;
  }

  it('serves a file of its folder', async () => {
    const server = await serving();

    expect(await ask(server, '/piece.ts')).toEqual({ status: 200, body: 'a piece' });
  });

  it('refuses a path that climbs out of its folder', async () => {
    const server = await serving();

    const answer = await ask(server, 'http://127.0.0.1/../../../secret.txt');

    expect(answer).toEqual({ status: 403, body: '' });
  });
});
