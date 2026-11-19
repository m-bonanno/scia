// `npm run dev`: the engine under plain Node, with a token the Vite proxy knows and its own
// folders, so it never touches the installed app's downloads.
import { resolve } from 'node:path';
import { DEV_API_PORT, DEV_API_TOKEN } from './dev-token.ts';
import { main } from './main.ts';

const root = resolve(import.meta.dirname, '../../../.dev');

main({
  SCIA_API_TOKEN: DEV_API_TOKEN,
  SCIA_PORT: String(DEV_API_PORT),
  SCIA_DATA_DIR: resolve(root, 'data'),
  SCIA_DOWNLOAD_DIR: resolve(root, 'downloads'),
  SCIA_VERSION: '0.0.0-dev',
  ...process.env,
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
