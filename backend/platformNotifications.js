import { supabase } from './supabaseClient.js';
import { mergeSchoolWithExtras, upsertSchoolExtras } from './schoolPlanStore.js';
import { getSubscriptionInfo, toDateString } from './subscription.js';

const REMINDER_WINDOW_DAYS = 10;
const REMINDER_INTERVAL_DAYS = 2;

const isMissingTableError = (error) => {
  const msg = String(error?.message || error?.details || error?.hint || '');
  return (
    error?.code === '42P01' ||
    msg.includes('platform_notifications') ||
    msg.includes('does not exist') ||
    msg.includes('Could not find')
  );
};

const isMissingColumnError = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '');
  return (
    msg.includes(column) &&
    (msg.includes('does not exist') ||
      msg.includes('Could not find') ||
      msg.includes('schema cache') ||
      error?.code === 'PGRST204')
  );
};

const clip = (value, max) => String(value || '').trim().slice(0, max);

export function formatPublicSupportBody({ fullName, email, contact, country, location, message }) {
  return [
    'Public support request',
    '',
    `Full name: ${clip(fullName, 120)}`,
    `Email: ${clip(email, 160)}`,
    `Contact: ${clip(contact, 80)}`,
    `Country: ${clip(country, 80)}`,
    `Location: ${clip(location, 120)}`,
    '',
    clip(message, 2000),
  ].join('\n');
}

export async function createPublicSupportNotification({
  schoolId,
  fullName,
  email,
  contact,
  country,
  location,
  message,
}) {
  return createPlatformNotification({
    schoolId,
    senderRole: 'school',
    subject: `Public request · ${clip(fullName, 80)}`,
    body: formatPublicSupportBody({ fullName, email, contact, country, location, message }),
    kind: 'public_support',
  });
}

export const isPublicSupportNotification = (row) =>
  String(row?.kind || '') === 'public_support' ||
  String(row?.subject || '').toLowerCase().startsWith('public request');

export async function createPlatformNotification({
  schoolId,
  senderRole,
  subject,
  body,
  kind = 'message',
  parentId = null,
  fromSchoolId = null,
}) {
  const payload = {
    school_id: schoolId,
    sender_role: senderRole,
    subject: subject?.trim() || null,
    body: String(body || '').trim(),
    kind,
    parent_id: parentId || null,
    from_school_id: fromSchoolId || null,
    created_at: new Date().toISOString(),
  };

  if (!payload.body) {
    throw new Error('Notification body is required');
  }

  let { data, error } = await supabase
    .from('platform_notifications')
    .insert([payload])
    .select()
    .single();

  if (error && payload.from_school_id && isMissingColumnError(error, 'from_school_id')) {
    delete payload.from_school_id;
    const retry = await supabase.from('platform_notifications').insert([payload]).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error && payload.kind && (isMissingColumnError(error, 'kind') || String(error.message || '').includes('kind'))) {
    delete payload.kind;
    const retry = await supabase.from('platform_notifications').insert([payload]).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (isMissingTableError(error)) {
      const err = new Error(
        'Notifications table is missing. Run backend/migrations/add_platform_notifications.sql in Supabase.'
      );
      err.status = 503;
      throw err;
    }
    throw error;
  }

  return data;
}

/** Bulk insert for broadcasting to many schools in one round-trip. */
export async function createPlatformNotificationsBatch(rows) {
  const payloads = (rows || [])
    .map((row) => ({
      school_id: row.schoolId,
      sender_role: row.senderRole,
      subject: row.subject?.trim() || null,
      body: String(row.body || '').trim(),
      kind: row.kind || 'message',
      parent_id: row.parentId || null,
      from_school_id: row.fromSchoolId || null,
      created_at: new Date().toISOString(),
    }))
    .filter((row) => row.body && row.school_id);

  if (!payloads.length) {
    throw new Error('Notification body is required');
  }

  let { data, error } = await supabase.from('platform_notifications').insert(payloads).select();

  if (error && isMissingColumnError(error, 'from_school_id')) {
    const stripped = payloads.map(({ from_school_id: _from, ...row }) => row);
    const retry = await supabase.from('platform_notifications').insert(stripped).select();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    if (isMissingTableError(error)) {
      const err = new Error(
        'Notifications table is missing. Run backend/migrations/add_platform_notifications.sql in Supabase.'
      );
      err.status = 503;
      throw err;
    }
    throw error;
  }

  return data || [];
}

export async function listSchoolNotifications(schoolId, { limit = 80 } = {}) {
  const withPeers = await supabase
    .from('platform_notifications')
    .select('*')
    .or(`school_id.eq.${schoolId},from_school_id.eq.${schoolId}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!withPeers.error) return withPeers.data || [];

  if (isMissingColumnError(withPeers.error, 'from_school_id')) {
    const fallback = await supabase
      .from('platform_notifications')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fallback.error) {
      if (isMissingTableError(fallback.error)) return [];
      throw fallback.error;
    }
    return fallback.data || [];
  }

  if (isMissingTableError(withPeers.error)) return [];
  throw withPeers.error;
}

export async function countUnreadSchoolNotifications(schoolId) {
  const incoming = await supabase
    .from('platform_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .is('read_at', null)
    .or(`sender_role.eq.super_admin,from_school_id.neq.${schoolId}`);

  if (!incoming.error) return incoming.count || 0;

  const fallback = await supabase
    .from('platform_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('sender_role', 'super_admin')
    .is('read_at', null);

  if (fallback.error) {
    if (isMissingTableError(fallback.error)) return 0;
    throw fallback.error;
  }
  return fallback.count || 0;
}

/** Unread replies from schools for the platform admin inbox. */
export async function countUnreadSuperAdminNotifications() {
  const { count, error } = await supabase
    .from('platform_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('sender_role', 'school')
    .is('read_at', null);

  if (error) {
    if (isMissingTableError(error)) return 0;
    throw error;
  }
  return count || 0;
}

export async function markNotificationRead(notificationId, schoolId) {
  const { data, error } = await supabase
    .from('platform_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('school_id', schoolId)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function markAllSchoolNotificationsRead(schoolId) {
  const { error } = await supabase
    .from('platform_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('school_id', schoolId)
    .is('read_at', null);

  if (error && !isMissingTableError(error)) throw error;
}

export async function listPeerSchools(excludeSchoolId) {
  const { data, error } = await supabase
    .from('schools')
    .select('id, name, email, role')
    .neq('id', excludeSchoolId)
    .order('name');

  if (error) throw error;
  return (data || [])
    .filter((row) => String(row.role || '').toLowerCase() !== 'super_admin')
    .map(({ id, name, email }) => ({ id, name, email }));
}

export async function listSuperAdminNotificationThreads({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('platform_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return data || [];
}

/**
 * Create in-app (and optionally email) reminders for schools due within 10 days,
 * at most once every 2 days per school.
 */
export async function runSubscriptionDueReminders({ sendEmail } = {}) {
  const today = toDateString(new Date());
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + REMINDER_WINDOW_DAYS);
  const windowEndStr = toDateString(windowEnd);

  const { data: schools, error } = await supabase
    .from('schools')
    .select('*')
    .not('payment_plan', 'is', null);

  if (error) throw error;

  const results = { checked: 0, notified: 0, skipped: 0, errors: [] };

  for (const school of schools || []) {
    if (String(school.role || '') === 'super_admin') continue;
    results.checked += 1;

    const merged = mergeSchoolWithExtras(school);
    if ((merged.plan_status || 'pending') !== 'approved') {
      results.skipped += 1;
      continue;
    }

    const sub = getSubscriptionInfo(merged);
    if (!sub.next_payment_due) {
      results.skipped += 1;
      continue;
    }

    const due = sub.next_payment_due;
    if (due < today || due > windowEndStr) {
      results.skipped += 1;
      continue;
    }

    const lastReminder = merged.last_due_reminder_at
      ? new Date(merged.last_due_reminder_at)
      : null;
    if (lastReminder) {
      const daysSince = (Date.now() - lastReminder.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < REMINDER_INTERVAL_DAYS) {
        results.skipped += 1;
        continue;
      }
    }

    const daysLeft = Math.max(0, sub.days_until_due ?? 0);
    const subject = 'Yearly subscription renewal reminder';
    const body =
      daysLeft === 0
        ? `Your SCHOOLTYPE yearly subscription for ${merged.name} is due today (${due}). Please renew to keep all features active.`
        : `Your SCHOOLTYPE yearly subscription for ${merged.name} is due in ${daysLeft} day${
            daysLeft === 1 ? '' : 's'
          } (on ${due}). Please renew before the due date to avoid interruption.`;

    try {
      await createPlatformNotification({
        schoolId: school.id,
        senderRole: 'super_admin',
        subject,
        body,
        kind: 'subscription_reminder',
      });

      await upsertSchoolExtras(school.id, {
        last_due_reminder_at: new Date().toISOString(),
      });

      // Persist reminder timestamp even if extras helper strips unknown columns.
      await supabase
        .from('schools')
        .update({ last_due_reminder_at: new Date().toISOString() })
        .eq('id', school.id);

      if (typeof sendEmail === 'function' && school.email) {
        try {
          await sendEmail({
            to: school.email,
            subject: `[SCHOOLTYPE] ${subject}`,
            text: body,
            html: `<p>${body}</p><p style="color:#64748b;font-size:12px">SCHOOLTYPE · Subscription reminder</p>`,
          });
        } catch (mailErr) {
          console.warn('Due reminder email failed:', mailErr.message);
        }
      }

      results.notified += 1;
    } catch (err) {
      results.errors.push({ schoolId: school.id, error: err.message });
    }
  }

  return results;
}
