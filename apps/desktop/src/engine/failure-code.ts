// Why a file of the profile was not written, as main's log says it: the system's code (EPERM,
// ENOSPC). Never the error's message, which names the file by its whole path, the person's account
// with it (#307).
export function failureCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.name : 'unknown';
}
