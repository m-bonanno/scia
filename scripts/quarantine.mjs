import { spawn } from 'node:child_process';

// The specs in quarantine, `[flaky #N]` in their name, and nothing else (vitest.config.ts, #186). It
// reports: a red run is news for each spec's issue, never a reason to run the gates again.
const child = spawn(
  'npx vitest run --project unit --project unit-renderer --project integration --project feature',
  { stdio: 'inherit', shell: true, env: { ...process.env, SCIA_QUARANTINE: '1' } },
);
child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
