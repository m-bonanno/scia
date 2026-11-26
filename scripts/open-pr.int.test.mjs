import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkTitle } from './open-pr.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// The title runs through the commitlint of the repository, with its config: the same check as the
// `Conventional title` job of pr-title.yml.
describe('checkTitle', () => {
  it('refuses a title commitlint refuses, and says why', () => {
    const refused = {
      'Chore: take the paperwork out': '[type-case]',
      'chore: Take the paperwork out': '[subject-case]',
      'chores: take the paperwork out': '[type-enum]',
      'chore take the paperwork out': '[type-empty]',
      [`chore: ${'a'.repeat(100)}`]: '[header-max-length]',
    };

    for (const [title, rule] of Object.entries(refused)) {
      const verdict = checkTitle(title, root);
      expect(verdict.ok, title).toBe(false);
      expect(verdict.report, title).toContain(rule);
    }
  });

  it('takes a conventional title in lower case, with a scope or a breaking mark', () => {
    for (const title of [
      'chore: take the paperwork out of the review loop',
      'fix(server): keep a page read',
      'feat(renderer)!: drop the old list',
    ]) {
      expect(checkTitle(title, root), title).toEqual({ ok: true, report: '' });
    }
  });
});
