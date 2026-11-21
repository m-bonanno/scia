import { describe, expect, it } from 'vitest';
import { useRun } from './scia.ts';

describe('the real app names its version', () => {
  const run = useRun();

  it('beside the name, and offers no update in a build that does not update itself', async () => {
    const profile = await run.profile();
    const scia = await run.launch(profile);
    const { page } = scia;
    const version = await scia.app.evaluate(({ app }) => app.getVersion());

    await page.getByRole('banner').getByText(version, { exact: true }).waitFor();
    // Main is asked as the page asks it: what a quit would install, and a restart for it.
    const answers = await page.evaluate(async () => {
      const shell = (
        window as unknown as {
          scia: { updateOffered(): Promise<unknown>; restartToUpdate(): Promise<unknown> };
        }
      ).scia;
      return { offered: await shell.updateOffered(), restart: await shell.restartToUpdate() };
    });

    expect(answers).toEqual({ offered: null, restart: 'nothing' });
    expect(await page.getByRole('button', { name: /^Update to/ }).count()).toBe(0);
  });
});
