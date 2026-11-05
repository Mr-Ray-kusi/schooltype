export const ATTENDANCE_TIMEZONE = 'Africa/Accra';

export function schoolLocalDate(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ATTENDANCE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // fall back to UTC
  }
  return date.toISOString().split('T')[0];
}

export function isSchoolWeekday(ymd) {
  const day = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: ATTENDANCE_TIMEZONE,
    weekday: 'short',
  }).format(new Date(`${day}T12:00:00.000Z`));
  return weekday !== 'Sat' && weekday !== 'Sun';
}

export function eachSchoolDay(from, to) {
  const days = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return days;
  const cursor = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const ymd = cursor.toISOString().slice(0, 10);
    if (isSchoolWeekday(ymd)) days.push(ymd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function schoolLocalDateLabel(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: ATTENDANCE_TIMEZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return schoolLocalDate(date);
  }
}
