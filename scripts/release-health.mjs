import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// What the Release watch says is wrong, besides a merge with no run at all: a run on develop's head
// that failed, and a tag semantic-release pushed without its release or its notes. #160 failed three
// runs in a row and was seen by chance (#185; docs/development/release-flow.md).
export function releaseProblems({ headRun, tags, releases, notes }) {
  const problems = [];
  if (headRun?.conclusion === 'failure') {
    problems.push(`The newest Release run on develop’s head failed: ${headRun.url}`);
  }
  for (const tag of tags) {
    if (!releases.includes(tag)) problems.push(`The tag ${tag} has no GitHub release.`);
    if (!notes.includes(tag)) {
      problems.push(`The tag ${tag} has no notes (refs/notes/semantic-release-${tag}).`);
    }
  }
  return problems;
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const lines = (text) => text.split('\n').filter((line) => line !== '');

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = process.env.REPO;
  const head = gh('api', `repos/${repo}/branches/develop`, '--jq', '.commit.sha');
  const run = JSON.parse(
    gh(
      'api',
      `repos/${repo}/actions/workflows/release.yml/runs?head_sha=${head}&per_page=1`,
      '--jq',
      '.workflow_runs[0] // null | if . == null then "null" else {conclusion, url: .html_url} | tojson end',
    ),
  );
  const refs = (prefix) =>
    lines(gh('api', '--paginate', `repos/${repo}/git/matching-refs/${prefix}`, '--jq', '.[].ref'));
  const problems = releaseProblems({
    headRun: run ?? undefined,
    tags: refs('tags/v').map((ref) => ref.replace('refs/tags/', '')),
    releases: lines(
      gh(
        'release',
        'list',
        '--repo',
        repo,
        '--limit',
        '1000',
        '--json',
        'tagName',
        '--jq',
        '.[].tagName',
      ),
    ),
    notes: refs('notes/semantic-release-').map((ref) =>
      ref.replace('refs/notes/semantic-release-', ''),
    ),
  });
  for (const problem of problems) console.log(`::error::${problem}`);
  if (problems.length === 0)
    console.log('Releases are healthy: the last run passed, every tag has its release and notes.');
  process.exitCode = problems.length === 0 ? 0 : 1;
}
