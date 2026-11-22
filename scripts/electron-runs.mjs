import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The E2E suite and the installer's smoke test start the real app, whose windows take the screen.
// The owner works on this machine: they run in CI, or by hand when a person says so (#171, #218).
export function mayStartElectron(env) {
  return env.CI === 'true' || env.SCIA_E2E_LOCAL === '1';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const project = process.argv[2];
  if (!mayStartElectron(process.env)) {
    console.error(
      `The ${project} project starts Electron, whose windows take the screen: it runs in CI. ` +
        'To run it here, set SCIA_E2E_LOCAL=1 (docs/development/testing.md).',
    );
    process.exitCode = 1;
  } else {
    // SCIA_E2E=1 is what makes vitest.config.ts list the project at all.
    const child = spawn(`npx vitest run --project ${project}`, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, SCIA_E2E: '1' },
    });
    child.on('close', (code) => {
      process.exitCode = code ?? 1;
    });
  }
}
