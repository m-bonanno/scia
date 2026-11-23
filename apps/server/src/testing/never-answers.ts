import { type RunProgram, runProgram } from '../sparse-file.ts';

// Runs, in place of the program asked for, one that never answers, with the options it was given.
// It ends by itself well after any spec's limit, so that one that is not ended leaves nothing
// running for long.
export const neverAnswers: RunProgram = (_file, _args, options) =>
  runProgram(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 30_000)'], options);
