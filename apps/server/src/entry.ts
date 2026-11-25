import { startFailedLine } from './logger.ts';
import { main } from './main.ts';

main().catch((error: unknown) => {
  console.error(startFailedLine(error));
  process.exit(1);
});
