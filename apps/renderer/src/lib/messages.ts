import { ApiErrorCode } from '@scia/contracts';
import { ApiError } from './api.ts';

// Errors: the fact, then the remedy. No blame, no «Ops».
const BY_CODE: Readonly<Record<string, string>> = {
  [ApiErrorCode.InvalidRequest]:
    'Non vedo indirizzi http o https validi in quello che hai inserito.',
  [ApiErrorCode.NotFound]: 'Questo download non è più in elenco.',
  [ApiErrorCode.Conflict]: 'Il download ha già cambiato stato. Riprova tra un istante.',
  [ApiErrorCode.Unauthorized]: 'Scia non riconosce questa finestra. Chiudi e riapri l’app.',
};

export const ENGINE_UNREACHABLE = 'Il motore di Scia non risponde. Nuovo tentativo in corso…';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return BY_CODE[error.code] ?? 'Scia non è riuscita a completare l’operazione. Riprova.';
  }
  return ENGINE_UNREACHABLE;
}
