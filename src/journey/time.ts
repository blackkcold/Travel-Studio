import type { TimeEvidence, TimePrecision } from '../domain';

function validParts(y: number, m: number, d: number, h = 0, min = 0, sec = 0): boolean {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return false;
  const date = new Date(0); date.setUTCFullYear(y, m - 1, d); date.setUTCHours(h, min, sec, 0);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
export function isValidDate(value: string): boolean { const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/); return !!match && validParts(Number(match[1]), Number(match[2]), Number(match[3])); }
export function dateOrdinal(value: string): number | undefined { if (!isValidDate(value)) return undefined; const [y, m, d] = value.split('-').map(Number); const date = new Date(0); date.setUTCFullYear(y, m - 1, d); date.setUTCHours(0, 0, 0, 0); return date.getTime() / 86_400_000; }
export function recordedDate(time: TimeEvidence): string | undefined { const date = time.value?.slice(0, 10); return date && isValidDate(date) ? date : undefined; }
/** Parses EXIF/local/ISO records without silently attaching the computer's timezone. */
export function parseTimeEvidence(raw?: string, offset?: string, source: TimeEvidence['source'] = 'exif', subsecond?: string): TimeEvidence {
  const unknown: TimeEvidence = { precision: 'unknown', source, ...(raw ? { raw } : {}) };
  if (!raw?.trim()) return unknown;
  const value = raw.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!match || !validParts(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0))) return unknown;
  if (!match[4]) return { value: value.slice(0, 10), precision: 'date', source, raw };
  const selectedOffset = match[8] ?? offset;
  if (selectedOffset && !/^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(selectedOffset)) return unknown;
  if (selectedOffset && /^[-+]14:/.test(selectedOffset) && !selectedOffset.endsWith(':00')) return unknown;
  const fraction = match[7] || (subsecond && /^\d{1,9}$/.test(subsecond) ? `.${subsecond}` : '');
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}${fraction}`;
  if (selectedOffset) { const instant = `${local}${selectedOffset}`; return { value: instant, precision: 'instant', source, raw, offset: selectedOffset, ...(subsecond ? { subsecond } : {}), utc: new Date(instant).toISOString() }; }
  return { value: local, precision: 'local', source, raw, ...(subsecond ? { subsecond } : {}) };
}
/** Local ordering uses calendar components only; this number is not a UTC assertion. */
export function sortableTime(time: TimeEvidence, basis: 'instant' | 'recorded-local'): number | undefined {
  if (time.precision === 'date' || time.precision === 'unknown' || !time.value) return undefined;
  if (basis === 'instant') {
    if (time.precision !== 'instant') return undefined;
    const literal = /(?:Z|[+-]\d{2}:\d{2})$/.test(time.value) ? time.value : `${time.value}${time.offset ?? ''}`;
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(literal)) return undefined;
    const n = Date.parse(literal); return Number.isFinite(n) ? n : undefined;
  }
  const local = time.value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '');
  const parsed = parseTimeEvidence(local, undefined, time.source);
  if (parsed.precision !== 'local') return undefined;
  return Date.parse(`${local}Z`);
}
export function formatTimeEvidence(time: TimeEvidence): string {
  if (time.precision === 'unknown' || !time.value) return '时间待确认';
  if (time.precision === 'date') return `${time.value} · 当日次序未定`;
  const label = time.value.replace('T', ' ');
  return time.precision === 'local' ? `${label} · 时区未知` : label;
}
export function timePrecisionLabel(precision: TimePrecision): string { return { instant: '含时区偏移', local: '本地拍摄记录', date: '仅日期', unknown: '时间待确认' }[precision]; }
export function weekdayLabel(value: string, locale = 'zh-CN'): string {
  if (!isValidDate(value)) return '';
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}
