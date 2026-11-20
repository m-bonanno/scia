import { pathToFileURL } from 'node:url';

// The two PRs of a release have no issue (docs/development/git-flow.md); neither has a PR no person opens.
const EXEMPT_MERGES = [
  { headRef: 'develop', baseRef: 'main' },
  { headRef: 'main', baseRef: 'develop' },
];
const EXEMPT_AUTHORS = ['dependabot[bot]'];

// GitHub's closing keywords, followed by a number of this repository.
const CLOSING = /(?<!\w)(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)/gi;

export function closingIssueNumbers(body) {
  const numbers = [...(body ?? '').matchAll(CLOSING)].map((match) => Number(match[1]));
  return [...new Set(numbers)];
}

export function isExempt({ author, headRepo, baseRepo, headRef, baseRef }) {
  if (EXEMPT_AUTHORS.includes(author)) return true;
  return (
    headRepo === baseRepo &&
    EXEMPT_MERGES.some((merge) => merge.headRef === headRef && merge.baseRef === baseRef)
  );
}

export async function checkLinkedIssue(pr, kindOf) {
  if (isExempt(pr)) return { ok: true, issues: [], exempt: true };

  const numbers = closingIssueNumbers(pr.body);
  if (numbers.length === 0) {
    return {
      ok: false,
      reason:
        'The body links no issue. Open an issue that explains the problem or the feature, then write "Closes #N" in the body.',
    };
  }

  const issues = [];
  const refused = [];
  for (const number of numbers) {
    const kind = await kindOf(number);
    if (kind === 'issue') issues.push(number);
    else if (kind === 'pull request') refused.push(`#${number} is a pull request, not an issue`);
    else refused.push(`#${number} does not exist in this repository`);
  }
  if (issues.length > 0) return { ok: true, issues };
  return { ok: false, reason: `${refused.join('; ')}. "Closes #N" names an issue.` };
}

async function kindOnGitHub(repository, token, number) {
  const response = await fetch(`https://api.github.com/repos/${repository}/issues/${number}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (response.status === 404 || response.status === 410) return 'missing';
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for #${number}`);
  const issue = await response.json();
  return issue.pull_request ? 'pull request' : 'issue';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const result = await checkLinkedIssue(
    {
      body: env.PR_BODY,
      author: env.PR_AUTHOR,
      headRepo: env.HEAD_REPO,
      baseRepo: env.BASE_REPO,
      headRef: env.HEAD_REF,
      baseRef: env.BASE_REF,
    },
    (number) => kindOnGitHub(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN, number),
  );
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  console.log(
    result.exempt
      ? 'Exempt: a release, its back-merge, or Dependabot.'
      : `Closes ${result.issues.map((n) => `#${n}`).join(', ')}.`,
  );
}
