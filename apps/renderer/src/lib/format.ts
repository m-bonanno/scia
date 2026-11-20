import { LOCALE } from '@scia/contracts/locale';

// Every number the person reads goes through here: one locale, a unit that never wraps away
// from its number.
const NBSP = '\u00a0';
// Between two facts on one line: a row's status, the speed and its limit.
export const SEPARATOR = ' \u00b7 ';
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// 1024-based, as Windows and every download dialog count.
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // "1.2 GB" but "340 MB" and "12 KB": a decimal only where it says something.
  const text = unit >= 2 && value < 100 ? oneDecimal.format(value) : whole.format(value);
  return `${text}${NBSP}${UNITS[unit] ?? 'B'}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${String(total)}${NBSP}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${String(minutes)}${NBSP}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}${NBSP}h ${String(minutes % 60).padStart(2, '0')}${NBSP}min`;
  }
  return `${String(Math.floor(hours / 24))}${NBSP}d ${String(hours % 24)}${NBSP}h`;
}

const day = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });

// A day, from an ISO instant, as it falls where the person is.
export function formatDate(instant: string): string {
  return day.format(new Date(instant));
}

export function formatPercent(done: number, total: number): string {
  if (total <= 0) return '0%';
  // Never "100%" while a byte is missing.
  return `${String(Math.min(done >= total ? 100 : 99, Math.floor((done / total) * 100)))}%`;
}
