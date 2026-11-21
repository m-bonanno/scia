import { describe, expect, it } from 'vitest';
import { releaseProblems } from './release-health.mjs';

const healthy = {
  headRun: { conclusion: 'success', url: 'https://example/run/1' },
  tags: ['v1.0.0-beta.24', 'v1.0.0-beta.25'],
  releases: ['v1.0.0-beta.24', 'v1.0.0-beta.25'],
  notes: ['v1.0.0-beta.24', 'v1.0.0-beta.25'],
};

describe('releaseProblems', () => {
  it('finds nothing when the last run passed and every tag has its release and its notes', () => {
    expect(releaseProblems(healthy)).toEqual([]);
  });

  it('finds nothing while the run on the head has not finished, or there is none yet', () => {
    expect(releaseProblems({ ...healthy, headRun: { conclusion: null, url: 'u' } })).toEqual([]);
    expect(releaseProblems({ ...healthy, headRun: undefined })).toEqual([]);
  });

  it('names a Release run on the head that ended any way but success', () => {
    for (const conclusion of ['failure', 'startup_failure', 'timed_out', 'cancelled']) {
      expect(
        releaseProblems({ ...healthy, headRun: { conclusion, url: 'https://example/run/2' } }),
        conclusion,
      ).toEqual([
        `The newest Release run on develop’s head ended ${conclusion}: https://example/run/2`,
      ]);
    }
  });

  it('names a tag with no release, and a tag with no notes (#160)', () => {
    expect(
      releaseProblems({
        ...healthy,
        tags: [...healthy.tags, 'v1.0.0-beta.26'],
        releases: healthy.releases,
        notes: healthy.notes,
      }),
    ).toEqual([
      'The tag v1.0.0-beta.26 has no GitHub release.',
      'The tag v1.0.0-beta.26 has no notes (refs/notes/semantic-release-v1.0.0-beta.26).',
    ]);
  });
});
