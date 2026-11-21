// A machine shared by several sessions can run fewer suites' workers at once (#184). Every project
// takes the same cap — the root's and the renderer's, which has a configuration of its own — or
// Vitest refuses to start (#201).
export function workerCapOf(value: string | undefined): { maxWorkers?: number } {
  const workers = Number(value);
  return Number.isInteger(workers) && workers > 0 ? { maxWorkers: workers } : {};
}

export const workerCap = workerCapOf(process.env.SCIA_TEST_WORKERS);
