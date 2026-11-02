import { describe, expect, test } from 'vitest';
import { staffPortalSessionForPath } from '../src/utils/staffPortalSession';

const session = {
  sessionToken: 'staff-jwt',
  portalToken: 'link-token',
  schoolSlug: 'school-one',
  portalPath: '/school-one/staff-portal',
  staff: { name: 'Ama' },
};

describe('staff portal session restore', () => {
  test('keeps the session when the same portal page is refreshed', () => {
    expect(staffPortalSessionForPath(session, '/school-one/staff-portal')).toBe(session);
    expect(staffPortalSessionForPath({ ...session, portalPath: '' }, '/staff-portal/link-token')).toBeTruthy();
    expect(staffPortalSessionForPath({ ...session, portalPath: '' }, '/school-one/staff-portal')).toBeTruthy();
  });

  test('does not reuse a session on a different portal link', () => {
    expect(staffPortalSessionForPath(session, '/other-school/staff-portal')).toBeNull();
    expect(staffPortalSessionForPath(session, '/staff-portal/another-token')).toBeNull();
    expect(staffPortalSessionForPath(null, '/school-one/staff-portal')).toBeNull();
  });
});