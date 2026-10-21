import React from 'react';
import { GraduationCap, Phone, School } from 'lucide-react';

const telHref = (phone) => {
  const raw = String(phone || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
};

const ScanIdentityCard = ({ user, message, alreadyMarked = false }) => {
  if (!user) return null;

  const isStudent = user.type === 'student';
  const callHref = telHref(user.parent_phone);
  const schoolName = user.school_name;
  const className = user.class || user.label;

  return (
    <div className="flex flex-col items-center text-center">
      <h3 className="text-2xl font-bold leading-tight text-white">{user.name}</h3>

      {schoolName ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
          <School className="h-4 w-4 shrink-0" />
          {schoolName}
        </p>
      ) : null}

      {className ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-white/80">
          <GraduationCap className="h-4 w-4 shrink-0" />
          {className}
        </p>
      ) : null}

      {message ? <p className="mt-2 text-sm text-white/80">{message}</p> : null}

      {alreadyMarked ? (
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-amber-100">
          Already marked today
        </p>
      ) : null}

      {isStudent && callHref ? (
        <a
          href={callHref}
          className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-base font-semibold text-slate-900 hover:bg-slate-100"
        >
          <Phone className="h-5 w-5" />
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Emergency — call parent
            </span>
            <span className="truncate">{user.parent_phone}</span>
          </span>
        </a>
      ) : null}

      {isStudent && !callHref ? (
        <p className="mt-3 text-xs text-white/70">No parent number on file</p>
      ) : null}
    </div>
  );
};

export default ScanIdentityCard;
