const ignoreMissing = (error) => {
  if (!error) return true;
  const msg = String(error.message || error.details || '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  );
};

const settleDelete = async (query) => {
  const { error } = await query;
  if (error && !ignoreMissing(error)) {
    console.warn('Person purge skipped a table:', error.message);
  }
};

const attendanceTypes = (kind) => {
  if (kind === 'staff') return ['staff'];
  if (kind === 'non-staff') return ['non-staff', 'nonstaff', 'non_staff'];
  return ['student'];
};

/** Remove a person's related rows before deleting the person record. */
export async function purgePersonRelated(supabase, { schoolId, personId, kind }) {
  if (!schoolId || !personId) return;

  await settleDelete(
    supabase.from('attendance').delete().eq('school_id', schoolId).eq('user_id', personId)
  );
  for (const userType of attendanceTypes(kind)) {
    await settleDelete(
      supabase
        .from('attendance')
        .delete()
        .eq('school_id', schoolId)
        .eq('user_id', personId)
        .eq('user_type', userType)
    );
  }

  if (kind === 'student') {
    await settleDelete(
      supabase.from('student_scores').delete().eq('school_id', schoolId).eq('student_id', personId)
    );
    await settleDelete(
      supabase.from('report_cards').delete().eq('school_id', schoolId).eq('student_id', personId)
    );
    await settleDelete(
      supabase.from('fee_payments').delete().eq('school_id', schoolId).eq('payer_id', personId)
    );
    await settleDelete(
      supabase.from('fees').delete().eq('school_id', schoolId).eq('student_id', personId)
    );
    await settleDelete(supabase.from('student_photos').delete().eq('student_id', personId));
    await settleDelete(supabase.from('person_photos').delete().eq('person_id', personId));
  }

  if (kind === 'staff') {
    await settleDelete(supabase.from('person_photos').delete().eq('person_id', personId));
  }

  if (kind === 'non-staff') {
    await settleDelete(supabase.from('person_photos').delete().eq('person_id', personId));
  }
}
