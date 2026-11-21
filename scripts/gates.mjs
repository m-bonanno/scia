import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The gates of docs/development/review-flow.md, in their order: the first that fails ends the run,
// so a session reads one failure, not five. Quiet: the tests print a dot per spec.
export const GATES = [
  { script: 'format:check', args: [] },
  { script: 'lint', args: [] },
  { script: 'typecheck', args: [] },
  { script: 'test', args: ['--reporter=dot'] },
  { script: 'build', args: [] },
];

export async function runGates(run) {
  for (const gate of GATES) {
    const code = await run(gate);
    if (code !== 0) return { ok: false, failed: gate.script };
  }
  return { ok: true, failed: undefined };
}

function npmRun(gate) {
  const command = [
    'npm',
    'run',
    gate.script,
    ...(gate.args.length > 0 ? ['--', ...gate.args] : []),
  ];
  console.log(`\n> gate: ${gate.script}`);
  return new Promise((resolve) => {
    // A shell: npm is a script on Windows, which spawn does not run by itself. One string, which
    // Node takes from a shell without the warning an argument list gets (DEP0190); every word is
    // one of GATES, written above.
    const child = spawn(command.join(' '), {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const startedAt = performance.now();
  const outcome = await runGates(npmRun);
  const seconds = Math.round((performance.now() - startedAt) / 1000);
  console.log(
    outcome.ok
      ? `\nThe gates are green (${seconds} s).`
      : `\nThe gate "${outcome.failed}" failed (${seconds} s); the gates after it did not run.`,
  );
  process.exitCode = outcome.ok ? 0 : 1;
}
