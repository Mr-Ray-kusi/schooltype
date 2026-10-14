import { platformSupabase } from './supabaseClient.js';

export async function logPlatformAction({ actor, action, targetSchoolId, detail }) {
  const row = {
    actor_school_id: actor?.schoolId || actor?.school_id || null,
    actor_email: actor?.email || null,
    action: String(action || 'unknown'),
    target_school_id: targetSchoolId || null,
    detail: detail && typeof detail === 'object' ? detail : {},
    created_at: new Date().toISOString(),
  };
  if (!platformSupabase) {
    console.log('[audit]', row.action, row.actor_email || '', row.target_school_id || '');
    return;
  }
  const { error } = await platformSupabase.from('platform_audit_log').insert([row]);
  if (error && error.code !== '42P01') {
    console.warn('Audit log write failed:', error.message);
  }
}
