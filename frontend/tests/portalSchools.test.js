import { describe, expect, test } from 'vitest';
import { collectPortalSchools, mergePortalSchools, portalSchoolProbes } from '../src/utils/portalSchools';

describe('student portal schools', () => {
  test('keeps a registered school and drops an embedded logo', () => {
    const schools = mergePortalSchools([
      [
        { id: 'one', name: 'SCHOOL ONE', logo_url: `data:image/jpeg;base64,${'a'.repeat(3000)}` },
        { id: 'one', name: 'SCHOOL ONE' },
        { id: 'blank', name: '  ' },
      ],
    ]);
    expect(schools).toEqual([{ id: 'one', name: 'SCHOOL ONE', logo_url: null }]);
  });

  test('a blank directory still finds a school by its name', async () => {
    const calls = [];
    const schools = await collectPortalSchools(
      async (q) => {
        calls.push(q || '');
        if (q === 'school') {
          return [{ id: 'one', name: 'SCHOOL ONE', logo_url: 'data:image/jpeg;base64,abc' }];
        }
        return [];
      },
      { probes: ['school', 'zz', 'sc'], concurrency: 1 }
    );
    expect(schools.map((school) => school.name)).toEqual(['SCHOOL ONE']);
    expect(calls[0]).toBe('');
    expect(calls).toContain('school');
    expect(calls).not.toContain('sc');
  });

  test('does not search further when the directory is already complete', async () => {
    const calls = [];
    const schools = await collectPortalSchools(
      async (q) => {
        calls.push(q || '');
        return [{ id: 'one', name: 'SCHOOL ONE' }];
      },
      { probes: ['school'] }
    );
    expect(schools).toHaveLength(1);
    expect(calls).toEqual(['']);
  });

  test('name probes include the word school', () => {
    expect(portalSchoolProbes()).toContain('school');
  });
});
