import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workerCapOf } from '../vitest.workers.ts';

// Where the test gate leaves Vitest's JSON report, from the root: the counts of the gates' line are
// read there, never counted from what the dot reporter prints.
export const TEST_REPORT = 'node_modules/.cache/scia-gates/vitest.json';

// The gates of docs/development/review-flow.md, in their order: the first that fails ends the run,
// so a session reads one failure, not five. Quiet: the tests print a dot per spec.
export const GATES = [
  { script: 'check:adr', args: [] },
  { script: 'format:check', args: [] },
  { script: 'lint', args: [] },
  { script: 'typecheck', args: [] },
  {
    script: 'test',
    args: ['--reporter=dot', '--reporter=json', `--outputFile.json=${TEST_REPORT}`],
  },
  { script: 'build', args: [] },
];

export async function runGates(run) {
  for (const gate of GATES) {
    const code = await run(gate);
    if (code !== 0) return { ok: false, failed: gate.script };
  }
  return { ok: true, failed: undefined };
}

export function npmRun(gate, spawnChild = spawn) {
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
    const child = spawnChild(command.join(' '), {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

// In the order and the words of Vitest's summary.
const STATES = ['failed', 'passed', 'skipped', 'todo'];

function tally(states) {
  return {
    ...Object.fromEntries(STATES.map((state) => [state, states.filter((s) => s === state).length])),
    total: states.length,
  };
}

// Vitest's JSON report calls a file passed or failed only; its summary counts a file as skipped when
// none of its tests runs, each one skipped or todo, and so does this.
function fileStateOf(file) {
  if (file.status === 'failed') return 'failed';
  const runsNone = file.assertionResults.every(
    ({ status }) => status === 'skipped' || status === 'todo',
  );
  return runsNone ? 'skipped' : 'passed';
}

export function testCountsOf(report, root, paths = path) {
  const files = report.testResults;
  return {
    files: tally(files.map(fileStateOf)),
    tests: tally(files.flatMap((file) => file.assertionResults.map(({ status }) => status))),
    failedFiles: files
      .filter((file) => file.status === 'failed')
      .map((file) => paths.relative(root, file.name).split(paths.sep).join('/')),
  };
}

function inVitestsWords(counts) {
  const states = STATES.filter((state) => counts[state] > 0).map(
    (state) => `${counts[state]} ${state}`,
  );
  return `${states.join(' | ')} (${counts.total})`;
}

function testsReached(outcome) {
  const at = (script) => GATES.findIndex((gate) => gate.script === script);
  return outcome.ok || at(outcome.failed) >= at('test');
}

// An unhandled error fails the test gate with every test passed, and the report does not name it:
// Vitest prints it above its summary.
function whyRed(outcome, failedFiles) {
  const named = failedFiles.map((file) => `\`${file}\``).join(', ');
  if (named) return `; failed: ${named}`;
  return outcome.failed === 'test' ? "; no test failed: Vitest's errors are printed above" : '';
}

// A pull request's run tests its head merged into its base, a commit GitHub makes: the workflow
// names the head (SCIA_GATES_HEAD in gates.yml), which the shallow clone does not hold.
export function commitOf({ tested, prHead }) {
  if (!prHead) return { head: tested, mergedAs: undefined };
  return { head: prHead.slice(0, tested.length), mergedAs: tested };
}

// The gates' line (docs/development/testing.md, "The gates' line").
export function gatesLineOf({ outcome, head, mergedAs, dirty, workers, seconds, counts }) {
  const verdict = outcome.ok ? 'green' : `red at \`${outcome.failed}\``;
  const merge = mergedAs ? ` merged into its base as \`${mergedAs}\`` : '';
  const commit = `\`${head}\`${merge}${dirty ? ' with changes not committed' : ''}`;
  const cap = workerCapOf(workers).maxWorkers;
  const workersUsed = cap ? `SCIA_TEST_WORKERS=${cap}` : "Vitest's own count of workers";
  const line = `\`npm run gates\` ${verdict} on ${commit}, ${workersUsed}, ${seconds} s`;
  if (!testsReached(outcome)) return line;
  if (!counts) return `${line} — Vitest wrote no report of its counts`;
  return (
    `${line} — Test Files ${inVitestsWords(counts.files)}; Tests ${inVitestsWords(counts.tests)}` +
    whyRed(outcome, counts.failedFiles)
  );
}

export function publish(
  line,
  { env = process.env, append = appendFileSync, log = console.log } = {},
) {
  log(`\n${line}`);
  if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function reportIn(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const { head, mergedAs } = commitOf({
    tested: git('rev-parse', '--short', 'HEAD'),
    prHead: process.env.SCIA_GATES_HEAD,
  });
  const dirty = git('status', '--porcelain') !== '';
  const reportFile = path.join(root, TEST_REPORT);
  // A report left by an earlier run would give this run its counts.
  rmSync(reportFile, { force: true });
  const startedAt = performance.now();
  const outcome = await runGates(npmRun);
  const seconds = Math.round((performance.now() - startedAt) / 1000);
  const report = reportIn(reportFile);
  const counts = report && testCountsOf(report, root);
  const workers = process.env.SCIA_TEST_WORKERS;
  publish(gatesLineOf({ outcome, head, mergedAs, dirty, workers, seconds, counts }));
  process.exitCode = outcome.ok ? 0 : 1;
}
