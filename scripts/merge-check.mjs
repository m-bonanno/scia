import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Whether the team's verdict on a branch holds across a merge of develop into it
// (docs/development/review-flow.md, "Rules"): `npm run check:merge [-- <merge>]`, HEAD by default.

// A dependency's upgrade writes a lockfile diff past the default megabyte of output.
const maxBuffer = 256 * 1024 * 1024;

function gitIn(cwd) {
  return (args, input) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer }).trim();
}

// The branch's own change, without the lines of develop around it: an entry appended next to
// develop's own appended entry keeps its id, where three lines of context would change it.
function ownChangeId(git, ...range) {
  const diff = git(['diff', '--no-ext-diff', '--no-color', '-U0', ...range]);
  return git(['patch-id', '--stable'], diff).split(' ')[0] ?? '';
}

// The merge git makes by itself, under the attributes the merge was made with: undefined when it
// stops on a conflict.
function automaticTree(cwd, head, develop) {
  const run = spawnSync(
    'git',
    [`--attr-source=${head}`, 'merge-tree', '--write-tree', head, develop],
    { cwd, encoding: 'utf8', maxBuffer },
  );
  if (run.status === 0) return run.stdout.trim();
  if (run.status === 1) return undefined;
  throw new Error(`git merge-tree failed: ${run.stderr.trim()}`);
}

export function checkMerge(cwd, merge = 'HEAD') {
  const git = gitIn(cwd);
  const [commit, head, develop, ...others] = git(['rev-list', '--parents', '-n', '1', merge]).split(
    ' ',
  );
  if (!head || !develop || others.length > 0)
    throw new Error(`${merge} is not a merge of two commits`);

  const tree = git(['rev-parse', `${commit}^{tree}`]);
  const byHand = automaticTree(cwd, head, develop) !== tree;
  const same = ownChangeId(git, `${develop}...${head}`) === ownChangeId(git, develop, commit);
  const outcome = byHand ? 'by-hand' : same ? 'carries' : 'changed';
  return { outcome, merge: commit, head, develop };
}

const short = (sha) => sha.slice(0, 7);

export function messageOf({ outcome, merge, head, develop }) {
  const rule = '(docs/development/review-flow.md, "Rules")';
  if (outcome === 'carries') {
    return `${short(merge)} brought in ${short(develop)} and changed nothing of the branch's own diff: the verdict on ${short(head)} holds for ${short(merge)}, and CI on it decides ${rule}.`;
  }
  const read = `Read it with \`git show --remerge-diff ${short(merge)}\`; after an approval, the tech lead does ${rule}.`;
  if (outcome === 'changed') return `${short(merge)} changed the branch's own diff. ${read}`;
  return `${short(merge)} is not the merge git makes by itself: a conflict resolved by hand, or a merge edited. ${read}`;
}

export function exitCodeOf({ outcome }) {
  return outcome === 'carries' ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = checkMerge(root, process.argv[2]);
  console.log(messageOf(result));
  process.exitCode = exitCodeOf(result);
}
