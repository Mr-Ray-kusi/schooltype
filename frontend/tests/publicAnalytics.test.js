import { describe, expect, test } from 'vitest';
import { publicAnalyticsPath } from '../src/utils/publicAnalytics';

describe('public analytics paths', () => {
  test('allows marketing, login, signup, and legal pages only', () => {
    expect(publicAnalyticsPath('/')).toBe('/');
    expect(publicAnalyticsPath('/plans/')).toBe('/plans');
    expect(publicAnalyticsPath('/login')).toBe('/login');
    expect(publicAnalyticsPath('/signup')).toBe('/signup');
    expect(publicAnalyticsPath('/privacy')).toBe('/privacy');
    expect(publicAnalyticsPath('/terms')).toBe('/terms');
  });

  test('drops student ids, payment links, scanner tokens, and signed-in pages', () => {
    expect(publicAnalyticsPath('/id/BFA-AS-2026-014')).toBeNull();
    expect(publicAnalyticsPath('/pay/student-1')).toBeNull();
    expect(publicAnalyticsPath('/fees')).toBeNull();
    expect(publicAnalyticsPath('/scan/secret-token')).toBeNull();
    expect(publicAnalyticsPath('/staff-portal/secret-token')).toBeNull();
    expect(publicAnalyticsPath('/students')).toBeNull();
    expect(publicAnalyticsPath('/fees-paid')).toBeNull();
    expect(publicAnalyticsPath('/report-cards')).toBeNull();
    expect(publicAnalyticsPath('/verify-email')).toBeNull();
  });
});
