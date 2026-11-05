import { describe, expect, test } from 'vitest';
import {
  assignPositions,
  letterGrade,
  ordinal,
  rankClassRoster,
  rankStudentsForReports,
} from '../src/utils/reportCardPdf';

const score = (student_name, subject, value, extra = {}) => ({
  student_name,
  student_id: student_name,
  class_name: 'JHS 1',
  term: 'Term 1',
  subject,
  score: value,
  ...extra,
});

describe('letterGrade', () => {
  test('maps each band to its letter', () => {
    expect([80, 70, 60, 50, 40, 39].map(letterGrade)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  test('shows a dash when a subject has no mark', () => {
    expect(letterGrade(null)).toBe('—');
    expect(letterGrade(NaN)).toBe('—');
  });
});

describe('ordinal', () => {
  test('uses st, nd, rd and th', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
  });

  test('the teens are all th', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
  });
});

describe('assignPositions', () => {
  test('a tie shares a position and the next one skips', () => {
    const ranked = assignPositions(
      [
        { student_name: 'Ama', total: 80 },
        { student_name: 'Kofi', total: 90 },
        { student_name: 'Yaw', total: 90 },
        { student_name: 'Esi', total: 70 },
      ],
      (row) => row.total
    );
    expect(ranked.map((row) => [row.student_name, row.position])).toEqual([
      ['Kofi', 1],
      ['Yaw', 1],
      ['Ama', 3],
      ['Esi', 4],
    ]);
  });
});

describe('rankStudentsForReports', () => {
  const scores = [
    score('Ama', 'Maths', 90),
    score('Ama', 'English', 80),
    score('Kofi', 'Maths', 60),
    score('Kofi', 'English', 50),
  ];

  test('ranks on total marks across subjects', () => {
    const ranked = rankStudentsForReports(scores, { className: 'JHS 1', term: 'Term 1' });
    expect(ranked.map((row) => [row.student_name, row.position])).toEqual([
      ['Ama', 1],
      ['Kofi', 2],
    ]);
  });

  test('a student is ranked against the whole class, not only the printed selection', () => {
    const ranked = rankStudentsForReports(scores, {
      className: 'JHS 1',
      term: 'Term 1',
      studentIds: ['Kofi'],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].position).toBe(2);
  });

  test('classes and terms are ranked separately', () => {
    const ranked = rankStudentsForReports([
      ...scores,
      score('Yaw', 'Maths', 10, { class_name: 'JHS 2' }),
    ]);
    const yaw = ranked.find((row) => row.student_name === 'Yaw');
    expect(yaw.position).toBe(1);
  });

  test('a subject with no mark entered is left out', () => {
    const ranked = rankStudentsForReports([score('Ama', 'Maths', null)]);
    expect(ranked).toEqual([]);
  });
});

describe('rankClassRoster', () => {
  test('every student in the class is listed and ranked by total marks', () => {
    const ranked = rankClassRoster(
      [
        { id: 'ama', name: 'Ama', class: 'JHS 1', roll_number: 'A-1' },
        { id: 'kofi', name: 'Kofi', class: 'JHS 1', roll_number: 'A-2' },
        { id: 'yaw', name: 'Yaw', class: 'JHS 1', roll_number: 'A-3' },
      ],
      [
        score('Ama', 'Maths', 90),
        score('Ama', 'English', 80),
        score('Kofi', 'Maths', 60),
        score('Kofi', 'English', 50),
      ],
      { className: 'JHS 1', term: 'Term 1' }
    );
    expect(ranked.map((row) => [row.student_name, row.position, row.totalMarks])).toEqual([
      ['Ama', 1, 170],
      ['Kofi', 2, 110],
      ['Yaw', 3, 0],
    ]);
  });
});
