import { describe, expect, it } from 'vitest';
import { PointerTooltip } from './pointer-tooltip.ts';

function tooltip() {
  const said: string[] = [];
  const answers: ((text: string) => void)[] = [];
  const failures: ((error: Error) => void)[] = [];
  const pointer = new PointerTooltip({
    plain: 'Scia',
    read: () =>
      new Promise((resolve, reject) => {
        answers.push(resolve);
        failures.push(reject);
      }),
    say: (text) => {
      said.push(text);
    },
  });
  // Lets the promise callbacks of an answer run.
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { said, answers, failures, pointer, settle };
}

describe('PointerTooltip', () => {
  it('says what it read while the pointer is still on the icon', async () => {
    const { said, answers, pointer, settle } = tooltip();

    pointer.entered();
    answers[0]!('Scia · 2 downloading');
    await settle();

    expect(said).toEqual(['Scia · 2 downloading']);
  });

  it('goes back to the plain name when the pointer leaves', async () => {
    const { said, answers, pointer, settle } = tooltip();

    pointer.entered();
    answers[0]!('Scia · 2 downloading');
    await settle();
    pointer.left();

    expect(said).toEqual(['Scia · 2 downloading', 'Scia']);
  });

  it('does not say an answer that arrives after the pointer has left', async () => {
    const { said, answers, pointer, settle } = tooltip();

    pointer.entered();
    pointer.left();
    answers[0]!('Scia · 2 downloading');
    await settle();

    expect(said).toEqual(['Scia']);
  });

  it('says only the answer of the visit the pointer is on', async () => {
    const { said, answers, pointer, settle } = tooltip();

    pointer.entered();
    pointer.left();
    pointer.entered();
    // The first visit's answer comes late, with what was true then.
    answers[0]!('Scia · 3 downloading');
    await settle();
    answers[1]!('Scia · 1 downloading');
    await settle();

    expect(said).toEqual(['Scia', 'Scia · 1 downloading']);
  });

  it('says nothing new when the engine does not answer', async () => {
    const { said, failures, pointer, settle } = tooltip();

    pointer.entered();
    failures[0]!(new Error('no answer in time'));
    await settle();

    expect(said).toEqual([]);
  });
});
