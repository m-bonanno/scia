import { describe, expect, it } from 'vitest';
import { messageOf, reviewOf } from './review-roles.mjs';

const file = (path, lines = 1) => ({ path, additions: lines, deletions: 0 });
const rolesOf = (review) => review.roles.map(({ role }) => role);

describe('reviewOf', () => {
  it('makes heavy, at any size, download and state code, the desktop, the manifest, the release config and the workflows', () => {
    const heavy = {
      'apps/server/src/download-task.ts': 'download and state code',
      'apps/server/src/state-store.ts': 'download and state code',
      'packages/core/src/segments.ts': 'download and state code',
      'packages/contracts/src/settings.ts': 'download and state code',
      'apps/desktop/src/main.ts': "the desktop's main or preload",
      'apps/desktop/src/preload.cts': "the desktop's main or preload",
      'apps/extension/static/manifest.json': "the extension's manifest",
      '.releaserc.json': 'the release config',
      'apps/desktop/electron-builder.yml': 'the release config',
      'apps/desktop/build/installer.nsh': 'the release config',
      '.github/workflows/gates.yml': 'a workflow',
    };

    for (const [path, what] of Object.entries(heavy)) {
      for (const title of ['fix: x', 'chore: x', 'ci: x']) {
        expect(reviewOf({ title, files: [file(path)] }), `${title} ${path}`).toMatchObject({
          tier: 'heavy',
          why: `${path} is ${what}`,
        });
      }
    }
  });

  it('gives a heavy PR every role its areas name, whatever its size', () => {
    const review = reviewOf({ title: 'fix: x', files: [file('apps/server/src/download-task.ts')] });

    expect(review.roles).toEqual([
      { role: 'tech-lead', why: 'always' },
      { role: 'backend-engineer', why: 'apps/server/src/download-task.ts' },
    ]);
    expect(review.callIn).toEqual([]);
  });

  it('makes light, the tech lead alone, a PR of docs, .claude/ and specs only, whatever its type', () => {
    const light = [
      'docs/development/review-flow.md',
      'docs/adr/0008-the-delivery-pipeline.md',
      'docs/design/downloads-dark.png',
      'docs/product/decisions.md',
      'CONTRIBUTING.md',
      'apps/renderer/CLAUDE.md',
      '.claude/agents/tech-lead.md',
      '.claude/commands/team-review.md',
      '.claude/settings.json',
      'apps/server/src/download-task.int.test.ts',
      'apps/renderer/src/app/app.test.tsx',
      'scripts/gates.test.mjs',
      'apps/desktop/e2e/quit.e2e.test.ts',
      'apps/desktop/e2e/scia.ts',
      'apps/server/src/testing/bunkr-server.ts',
      'scripts/testing/net-guard.mjs',
    ];

    for (const title of ['fix: x', 'test: x', 'docs: x']) {
      const review = reviewOf({ title, files: light.map((path) => file(path, 400)) });

      expect(review.tier, title).toBe('light');
      expect(rolesOf(review), title).toEqual(['tech-lead']);
      expect(review.callIn, title).toEqual([]);
    }
  });

  it('makes light a chore or a ci that touches no runtime path, and only those types', () => {
    const tooling = ['scripts/gates.mjs', 'eslint.config.js', 'package.json', '.husky/pre-push'];

    for (const title of ['chore: x', 'chore(scripts): x', 'ci: x', 'ci(release)!: x']) {
      const review = reviewOf({ title, files: tooling.map((path) => file(path, 300)) });

      expect(review.tier, title).toBe('light');
      expect(rolesOf(review), title).toEqual(['tech-lead']);
    }
    for (const title of ['fix: x', 'refactor: x', 'perf: x']) {
      expect(reviewOf({ title, files: tooling.map((path) => file(path)) }).tier, title).toBe(
        'standard',
      );
    }
  });

  it('keeps a chore that touches a runtime path, or the lockfile, out of the light tier', () => {
    const runtime = [
      'apps/renderer/src/app/app.tsx',
      'apps/extension/src/popup.ts',
      'apps/desktop/package.json',
      'apps/desktop/scripts/fetch-tools.ts',
      'package-lock.json',
    ];

    for (const path of runtime) {
      const files = [file(path), file('scripts/gates.mjs'), file('docs/x.md')];

      expect(reviewOf({ title: 'chore: x', files }).tier, path).toBe('standard');
      expect(reviewOf({ title: 'fix: x', files }).tier, path).toBe('standard');
    }
  });

  it('reads a title with no type as neither a chore nor a feat', () => {
    const review = reviewOf({ title: '', files: [file('scripts/gates.mjs')] });

    expect(review.tier).toBe('standard');
    expect(rolesOf(review)).toEqual(['tech-lead']);
  });

  it('leaves a standard PR of 20 lines or fewer to the tech lead, who may call its areas in', () => {
    const review = reviewOf({
      title: 'fix: x',
      files: [file('apps/renderer/src/app/app.tsx', 20)],
    });

    expect(review.tier).toBe('standard');
    expect(review.lines).toBe(20);
    expect(rolesOf(review)).toEqual(['tech-lead']);
    expect(review.callIn).toEqual([
      { role: 'frontend-engineer', why: 'apps/renderer/src/app/app.tsx' },
      { role: 'product-designer', why: 'apps/renderer/src/app/app.tsx' },
    ]);
  });

  it('gives a standard PR of more than 20 lines every role its areas name', () => {
    const files = [
      file('apps/extension/static/popup.html', 15),
      file('apps/extension/src/popup.ts', 6),
    ];
    const review = reviewOf({ title: 'fix: x', files });

    expect(review.lines).toBe(21);
    expect(review.roles).toEqual([
      { role: 'tech-lead', why: 'always' },
      { role: 'frontend-engineer', why: 'apps/extension/static/popup.html' },
      { role: 'product-designer', why: 'apps/extension/static/popup.html' },
    ]);
    expect(review.callIn).toEqual([]);
  });

  it('counts the lines of every file outside docs, .claude/ and specs, its deletions too', () => {
    const files = [
      { path: 'apps/renderer/src/app/app.tsx', additions: 4, deletions: 6 },
      { path: 'scripts/gates.mjs', additions: 10, deletions: 0 },
      file('apps/renderer/src/app/app.test.tsx', 500),
      file('scripts/gates.test.mjs', 500),
      file('docs/development/testing.md', 500),
      file('.claude/agents/tech-lead.md', 500),
    ];

    expect(reviewOf({ title: 'fix: x', files }).lines).toBe(20);
  });

  it('weighs the path a renamed file leaves as well as the one it takes', () => {
    const files = [
      { path: 'docs/notes.md', previous: 'apps/desktop/src/tray.ts', additions: 3, deletions: 2 },
    ];

    expect(reviewOf({ title: 'chore: x', files })).toMatchObject({
      tier: 'heavy',
      lines: 5,
      roles: [
        { role: 'tech-lead', why: 'always' },
        { role: 'backend-engineer', why: 'apps/desktop/src/tray.ts' },
      ],
    });
  });

  it('makes a release into main heavy, its product manager included', () => {
    const review = reviewOf({ title: 'release: v1.0.0', base: 'main', files: [file('docs/x.md')] });

    expect(review).toMatchObject({ tier: 'heavy', why: 'a release into main' });
    expect(review.roles).toContainEqual({ role: 'product-manager', why: 'a release into main' });
  });

  it('calls the product manager to a feat and to the roadmap, the vision or the README, in every tier', () => {
    const cases = [
      ['feat: x', 'apps/server/src/download-task.ts', 'a feat'],
      ['feat(renderer)!: x', 'apps/renderer/src/app/app.tsx', 'a feat'],
      ['feat: x', 'docs/development/review-flow.md', 'a feat'],
      ['docs: x', 'docs/product/roadmap.md', 'docs/product/roadmap.md'],
      ['docs: x', 'docs/product/vision.md', 'docs/product/vision.md'],
      ['docs: x', 'README.md', 'README.md'],
    ];

    for (const [title, path, why] of cases) {
      const review = reviewOf({ title, files: [file(path)] });

      expect(review.roles, `${title} ${path}`).toContainEqual({ role: 'product-manager', why });
    }
  });

  it('leaves the product manager out of a fix, and of the product docs beyond the roadmap and the vision', () => {
    const paths = [
      'docs/product/decisions.md',
      'docs/product/evidence.md',
      'apps/server/src/app.ts',
    ];

    expect(rolesOf(reviewOf({ title: 'fix: x', files: paths.map((path) => file(path)) }))).toEqual([
      'tech-lead',
      'backend-engineer',
    ]);
  });

  it('adds a role the paths cannot tell, once, in the order of the team', () => {
    const review = reviewOf({
      title: 'fix: x',
      files: [file('apps/desktop/src/tray.ts')],
      add: ['product-manager', 'product-designer', 'backend-engineer'],
    });

    expect(review.roles).toEqual([
      { role: 'tech-lead', why: 'always' },
      { role: 'backend-engineer', why: 'apps/desktop/src/tray.ts' },
      { role: 'product-designer', why: 'added by hand' },
      { role: 'product-manager', why: 'added by hand' },
    ]);
  });

  it('calls in no role the session already added', () => {
    const review = reviewOf({
      title: 'fix: x',
      files: [file('apps/renderer/src/app/app.tsx')],
      add: ['frontend-engineer'],
    });

    expect(rolesOf(review)).toEqual(['tech-lead', 'frontend-engineer']);
    expect(review.callIn).toEqual([
      { role: 'product-designer', why: 'apps/renderer/src/app/app.tsx' },
    ]);
  });

  it('refuses a role the team does not have', () => {
    expect(() =>
      reviewOf({ title: 'fix: x', files: [file('README.md')], add: ['designer', 'qa'] }),
    ).toThrow(
      'No role designer, qa. The roles: tech-lead, backend-engineer, frontend-engineer, product-designer, product-manager.',
    );
  });
});

describe('messageOf', () => {
  it('names the tier, its reason and each role with its own', () => {
    const review = reviewOf({ title: 'feat: x', files: [file('apps/desktop/src/main.ts')] });

    expect(messageOf(review)).toBe(
      [
        "heavy: apps/desktop/src/main.ts is the desktop's main or preload.",
        '- tech-lead: always',
        '- backend-engineer: apps/desktop/src/main.ts',
        '- product-manager: a feat',
      ].join('\n'),
    );
  });

  it('says that a standard PR of a few lines is the tech lead alone, and whom it may call in', () => {
    const review = reviewOf({ title: 'fix: x', files: [file('apps/renderer/src/app/app.tsx', 3)] });

    expect(messageOf(review)).toBe(
      [
        "standard: 3 lines outside docs, .claude/ and specs, 20 or fewer: the tech lead's alone.",
        '- tech-lead: always',
        'May be called in: frontend-engineer (apps/renderer/src/app/app.tsx), product-designer (apps/renderer/src/app/app.tsx).',
      ].join('\n'),
    );
  });

  it('says why a light PR is light', () => {
    expect(messageOf(reviewOf({ title: 'docs: x', files: [file('docs/x.md')] }))).toBe(
      'light: docs, .claude/ and specs only.\n- tech-lead: always',
    );
    expect(messageOf(reviewOf({ title: 'ci: x', files: [file('scripts/gates.mjs')] }))).toBe(
      'light: a ci that touches no runtime path.\n- tech-lead: always',
    );
  });
});
