export function isInternalAttendanceCode(value) {
  return /-(STU|STAFF|NONSTAFF)-/i.test(String(value || ''));
}

export function displayStudentId(person) {
  const roll = String(person?.roll_number || person?.rollNumber || '').trim();
  if (roll && !isInternalAttendanceCode(roll)) return roll;
  return '';
}
