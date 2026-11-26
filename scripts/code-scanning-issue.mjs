import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { labelsOf } from './open-pr.mjs';

// One issue lists the code-scanning alerts open on develop, kept by the Code scanning alerts
// workflow (#383). CodeQL fails a pull request only for the alerts it brings: six alerts sat on
// develop for two days, and nothing in the flow brought them up.

export const MARKER = '<!-- code-scanning-alerts -->';
export const TITLE = 'fix: the open code-scanning alerts of develop';
const BOT = 'github-actions[bot]';

const byNumber = (alerts) => [...alerts].sort((a, b) => a.number - b.number);
const pathOf = (alert) => alert.most_recent_instance.location.path;

export function bodyOf(alerts) {
  const rows = byNumber(alerts).map((alert) => {
    const severity = alert.rule.security_severity_level ?? alert.rule.severity;
    const where = `${pathOf(alert)}:${String(alert.most_recent_instance.location.start_line)}`;
    return `| [#${String(alert.number)}](${alert.html_url}) | \`${alert.rule.id}\` | ${severity} | \`${where}\` |`;
  });
  return [
    MARKER,
    'Code scanning has alerts open on `develop`. The `Code scanning alerts` workflow keeps this list each week, and closes this issue once none is left (#383). Each alert is fixed in a PR, or dismissed on GitHub by the owner with its reason.',
    '',
    '| Alert | Rule | Severity | Where |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

// The numbers of the alerts a body of this script lists.
function numbersIn(body) {
  return [...body.matchAll(/^\| \[#(\d+)\]/gm)].map((match) => Number(match[1]));
}

const named = (numbers) => numbers.map((number) => `#${String(number)}`).join(', ');

// What becomes of the issue: opened, edited, closed, or left as it is.
export function issueStep({ alerts, issue, owner, scan }) {
  // The owner has not read a new list yet; once read, its status is the owner's, never set again.
  const labels = labelsOf({ title: TITLE, paths: alerts.map(pathOf) });
  if (issue === undefined) {
    if (alerts.length === 0) return { kind: 'none' };
    return {
      kind: 'open',
      title: TITLE,
      body: bodyOf(alerts),
      labels: [...labels, 'status:triage'],
      assignees: [owner],
    };
  }
  if (alerts.length === 0) {
    return {
      kind: 'close',
      number: issue.number,
      comment: `No code-scanning alert is open on \`develop\` any more, as of ${scan}.`,
    };
  }
  const body = bodyOf(alerts);
  if (issue.body.replaceAll('\r\n', '\n') === body) return { kind: 'none' };
  const before = numbersIn(issue.body);
  const now = byNumber(alerts).map((alert) => alert.number);
  const came = now.filter((number) => !before.includes(number));
  const went = before.filter((number) => !now.includes(number));
  // A comment tells whoever follows the issue; an alert that only moved with its code is not news.
  const comment =
    came.length + went.length === 0
      ? undefined
      : [
          `The alerts changed with ${scan}.`,
          ...(came.length > 0 ? [`New: ${named(came)}.`] : []),
          ...(went.length > 0 ? [`No longer open: ${named(went)}.`] : []),
        ].join(' ');
  return { kind: 'edit', number: issue.number, body, labels, comment };
}

// The open issue this workflow opened: by its author and its mark, the oldest if there are two.
export function listingIssue(issues) {
  const ours = issues
    .filter((issue) => issue.user.login === BOT && issue.body?.includes(MARKER))
    .sort((a, b) => a.number - b.number);
  return ours[0] === undefined ? undefined : { number: ours[0].number, body: ours[0].body };
}

const gh = (args, input) =>
  execFileSync('gh', args, { encoding: 'utf8', ...(input === undefined ? {} : { input }) }).trim();
const jsonLines = (text) =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
const send = (method, path, payload) =>
  gh(['api', '--method', method, path, '--input', '-'], JSON.stringify(payload));

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = process.env.REPO;
  const alerts = jsonLines(
    gh([
      'api',
      '--paginate',
      `repos/${repo}/code-scanning/alerts?ref=refs/heads/develop&state=open&per_page=100`,
      '--jq',
      '.[] | tojson',
    ]),
  );
  const [analysis] = jsonLines(
    gh([
      'api',
      `repos/${repo}/code-scanning/analyses?ref=refs/heads/develop&per_page=1`,
      '--jq',
      '.[] | {created_at, commit_sha} | tojson',
    ]),
  );
  const scan =
    analysis === undefined
      ? 'the last scan of `develop`'
      : `the scan of ${analysis.created_at.slice(0, 10)} on \`${analysis.commit_sha.slice(0, 7)}\``;
  const issue = listingIssue(
    jsonLines(
      gh([
        'api',
        '--paginate',
        `repos/${repo}/issues?state=open&per_page=100`,
        '--jq',
        // The bodies of every open issue would outgrow execFileSync's buffer of 1 MiB.
        `.[] | select(.pull_request == null and .user.login == "${BOT}") | {number, body, user: {login: .user.login}} | tojson`,
      ]),
    ),
  );
  const step = issueStep({ alerts, issue, owner: process.env.OWNER, scan });
  console.log(`${String(alerts.length)} alerts open on develop, read from ${scan}.`);
  switch (step.kind) {
    case 'open': {
      const { title, body, labels, assignees } = step;
      const opened = JSON.parse(
        send('POST', `repos/${repo}/issues`, { title, body, labels, assignees }),
      );
      console.log(`Opened ${opened.html_url}`);
      break;
    }
    case 'edit':
      send('PATCH', `repos/${repo}/issues/${String(step.number)}`, { body: step.body });
      send('POST', `repos/${repo}/issues/${String(step.number)}/labels`, { labels: step.labels });
      if (step.comment !== undefined) {
        send('POST', `repos/${repo}/issues/${String(step.number)}/comments`, {
          body: step.comment,
        });
      }
      console.log(`Edited #${String(step.number)}. ${step.comment ?? 'The same alerts, moved.'}`);
      break;
    case 'close':
      send('POST', `repos/${repo}/issues/${String(step.number)}/comments`, { body: step.comment });
      send('PATCH', `repos/${repo}/issues/${String(step.number)}`, {
        state: 'closed',
        state_reason: 'completed',
      });
      console.log(`Closed #${String(step.number)}.`);
      break;
    default:
      console.log(
        issue === undefined ? 'No issue to open.' : `#${String(issue.number)} is up to date.`,
      );
  }
}
