import { main } from './main.ts';

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'error', event: 'engine_start_failed', error: String(error) }),
  );
  process.exit(1);
});
