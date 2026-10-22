export const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

const API_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,3})?\d*(Z|[+-]\d{2}:\d{2})?$/;

const TRADE_TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function parseApiTime(value: unknown): Date | null {
  const parts = typeof value === 'string' ? API_TIME.exec(value) : null;
  if (!parts) return null;
  const date = new Date(`${parts[1]}${parts[2] ?? ''}${parts[3] ?? 'Z'}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const formatTradeTime = (date: Date): string => TRADE_TIME_FORMAT.format(date);
