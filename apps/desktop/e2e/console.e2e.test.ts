import { describe, expect, it } from 'vitest';
import { useRun } from './scia.ts';

describe('the real page', () => {
  const run = useRun();

  it('loads with no error in its console, its policy asked nothing it refuses (#61)', async () => {
    const profile = await run.profile();
    const { page } = await run.launch(profile);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    // Loaded again with the console heard from its first line: the window loaded the page
    // before the spec could listen. Its list drawn empty is the engine's first answer, parsed.
    await page.reload();
    await page.getByText('No downloads', { exact: true }).waitFor();

    expect(errors).toEqual([]);
  });
});
