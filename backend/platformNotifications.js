import { supabase } from './supabaseClient.js';
import { mergeSchoolWithExtras, upsertSchoolExtras } from './schoolPlanStore.js';
import {
  getSubscriptionInfo,
  toDateString,
  reminderMilestoneDue,
  parseDueReminderSent,
  formatDueReminderSent,
  coerceYearlyBillingToTerm,
} from './subscription.js';

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

export function parsePublicSupportContact(body) {
  const text = String(body || '');
  const pick = (label) => {
    const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
    return String(match?.[1] || '').trim();
  };
  const email = pick('Email');
  const fullName = pick('Full name');
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
    fullName,
  };
}

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
 * Email the school admin 14, 7, and 1 days before the term plan ends.
 */
export async function runSubscriptionDueReminders({ sendEmail } = {}) {
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
    const coerced = coerceYearlyBillingToTerm(merged);
    if (coerced) {
      Object.assign(merged, coerced);
      upsertSchoolExtras(school.id, coerced).catch(() => {});
    }

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
    const sent = parseDueReminderSent(merged.due_reminder_sent, due);
    const milestone = reminderMilestoneDue(sub.days_until_due, sent);
    if (!milestone) {
      results.skipped += 1;
      continue;
    }

    const started = sub.last_payment_at || sub.subscription_started_at || '—';
    const subject =
      milestone === 1
        ? 'Term plan ends tomorrow'
        : `Term plan ends in ${milestone} days`;
    const body = [
      `Your SCHOOLTYPE term plan for ${merged.name} ends in ${milestone} day${milestone === 1 ? '' : 's'}.`,
      '',
      `Term started: ${started}`,
      `Term ends: ${due}`,
      '',
      'Renew before the end date to keep adding results, changing setup, downloading records, paying staff, and moving wallet money. After the term ends, the school can still view records and record fees.',
    ].join('\n');

    try {
      await createPlatformNotification({
        schoolId: school.id,
        senderRole: 'super_admin',
        subject,
        body,
        kind: 'subscription_reminder',
      });

      const reminderStamp = formatDueReminderSent(due, [...sent, milestone]);
      await upsertSchoolExtras(school.id, {
        last_due_reminder_at: new Date().toISOString(),
        due_reminder_sent: reminderStamp,
      });

      const stamp = {
        last_due_reminder_at: new Date().toISOString(),
        due_reminder_sent: reminderStamp,
      };
      const { error: stampError } = await supabase.from('schools').update(stamp).eq('id', school.id);
      if (stampError && isMissingColumnError(stampError, 'due_reminder_sent')) {
        await supabase
          .from('schools')
          .update({ last_due_reminder_at: stamp.last_due_reminder_at })
          .eq('id', school.id);
      }

      if (typeof sendEmail === 'function' && school.email) {
        try {
          await sendEmail({
            to: school.email,
            subject: `[SCHOOLTYPE] ${subject}`,
            text: body,
            html: `<p>${body.replace(/\n/g, '<br/>')}</p><p style="color:#64748b;font-size:12px">SCHOOLTYPE · Term plan reminder</p>`,
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
