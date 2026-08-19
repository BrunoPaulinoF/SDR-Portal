function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((part) => part.type === type)?.value ?? '0');
}

function timeZoneOffsetMinutes(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(value);
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::?(?<minutes>\d{2}))?)?$/.exec(offset);

  if (!match) {
    return 0;
  }

  const sign = match.groups?.sign === '-' ? -1 : 1;
  const hours = Number(match.groups?.hours ?? '0');
  const minutes = Number(match.groups?.minutes ?? '0');
  return sign * (hours * 60 + minutes);
}

export function startOfDayInTimeZone(value: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = datePart(parts, 'year');
  const month = datePart(parts, 'month');
  const day = datePart(parts, 'day');
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetMinutes = timeZoneOffsetMinutes(new Date(utcMidnight), timeZone);

  return new Date(utcMidnight - offsetMinutes * 60 * 1000);
}

export function formatDateTimeInTimeZone(value: Date | null | undefined, timeZone: string): string {
  if (!value) return '-';

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(value);
}

/** Parte do dia usada para a saudacao: sem isso a IA chuta "boa noite" as 11h. */
function partOfDay(hour: number): string {
  if (hour < 12) return 'manha';
  if (hour < 18) return 'tarde';
  return 'noite';
}

/**
 * Momento atual no fuso do SDR, em texto para o prompt: "quinta-feira, 11:51 (manha)".
 * Vai na regiao volatil do prompt, nunca no prefixo estavel.
 */
export function describeNowInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(get('hour'));

  return `${get('weekday')}, ${get('hour')}:${get('minute')} (${partOfDay(Number.isFinite(hour) ? hour : 12)})`;
}
