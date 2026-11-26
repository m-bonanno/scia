import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bodyFileOf, createArgs, labelsOf } from './open-pr.mjs';

describe('labelsOf', () => {
  it("gives the title's type its label, as git-flow.md says", () => {
    const labels = {
      'feat: add a thing': 'enhancement',
      'feat(renderer)!: change a thing': 'enhancement',
      'fix(server): mend a thing': 'bug',
      'hotfix: mend it now': 'bug',
      'docs: say a thing': 'docs',
      'test(engine): hold a thing': 'test',
      'chore: tidy a thing': 'chore',
      'refactor(core): move a thing': 'chore',
      'ci(release): release a thing': 'chore',
      'build: pack a thing': 'chore',
      'perf: speed a thing': 'chore',
      'style: format a thing': 'chore',
      'revert: take a thing back': 'chore',
    };

    for (const [title, label] of Object.entries(labels)) {
      expect(labelsOf({ title, paths: [] }), title).toEqual([label]);
    }
  });

  it('labels the area of each path', () => {
    const areas = {
      'apps/server/src/engine.ts': 'area:engine',
      'packages/core/src/queue.ts': 'area:engine',
      'apps/desktop/src/main.ts': 'area:desktop',
      'apps/desktop/e2e/quit.e2e.test.ts': 'area:desktop',
      'apps/renderer/src/App.tsx': 'area:renderer',
      'apps/extension/src/worker.ts': 'area:extension',
      '.github/workflows/gates.yml': 'area:ci',
      '.husky/pre-push': 'area:ci',
      'scripts/gates.mjs': 'area:ci',
      'docs/development/review-flow.md': 'area:ci',
      '.claude/commands/team-review.md': 'area:ci',
      '.claude/agents/tech-lead.md': 'area:ci',
      '.releaserc.json': 'area:ci',
      'vitest.config.ts': 'area:ci',
      'package.json': 'area:ci',
      '.gitattributes': 'area:ci',
    };

    for (const [file, label] of Object.entries(areas)) {
      expect(labelsOf({ title: 'chore: x', paths: [file] }), file).toEqual(['chore', label]);
    }
  });

  it('gives no area to what belongs to none: the product, its records, a gotcha, the contracts', () => {
    const paths = [
      'README.md',
      'CONTRIBUTING.md',
      'docs/product/roadmap.md',
      'docs/adr/0008-the-delivery-pipeline.md',
      'docs/design/downloads-dark.png',
      '.claude/gotchas.md',
      'packages/contracts/src/settings.ts',
    ];

    expect(labelsOf({ title: 'docs: x', paths })).toEqual(['docs']);
  });

  it('names each area once, in the order of the list, the type first', () => {
    const paths = [
      'apps/renderer/src/App.tsx',
      'apps/server/src/engine.ts',
      'packages/core/src/queue.ts',
      'apps/renderer/src/Row.tsx',
    ];

    expect(labelsOf({ title: 'feat: x', paths })).toEqual([
      'enhancement',
      'area:engine',
      'area:renderer',
    ]);
  });

  it('adds the labels no path tells, given by hand, once', () => {
    const extra = ['area:integrations', 'accessibility', 'area:engine'];

    expect(labelsOf({ title: 'fix: x', paths: ['apps/server/src/x.ts'], extra })).toEqual([
      'bug',
      'area:engine',
      'area:integrations',
      'accessibility',
    ]);
  });
});

describe('bodyFileOf', () => {
  it('takes the body from .claude/pr-bodies/<branch>.md', () => {
    const root = path.join(path.sep, 'scia');

    expect(bodyFileOf(root, 'chore/373-paperwork-out-of-review')).toBe(
      path.join(root, '.claude', 'pr-bodies', 'chore', '373-paperwork-out-of-review.md'),
    );
  });
});

describe('createArgs', () => {
  it('opens the PR into develop, with its body and labels, assigned to whoever opens it', () => {
    const args = createArgs({
      title: 'chore: take the paperwork out of the review loop',
      bodyFile: '/scia/.claude/pr-bodies/chore/373-x.md',
      labels: ['chore', 'area:ci'],
    });

    expect(args).toEqual([
      'pr',
      'create',
      '--base',
      'develop',
      '--title',
      'chore: take the paperwork out of the review loop',
      '--body-file',
      '/scia/.claude/pr-bodies/chore/373-x.md',
      '--assignee',
      '@me',
      '--label',
      'chore,area:ci',
    ]);
  });
});
