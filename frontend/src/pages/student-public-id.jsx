import React, { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { GraduationCap, User, Hash, Briefcase, Trophy } from 'lucide-react';

const StudentPublicId = () => {
  const { barcode } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: profile } = await axios.get(
          `/api/public/id/${encodeURIComponent(barcode || '')}`,
          { params: { g: searchParams.get('g') || undefined, s: searchParams.get('s') || undefined } }
        );
        if (!cancelled) setData(profile);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'ID not found');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [barcode, searchParams]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 font-sans text-slate-300">
        Loading ID…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 font-sans text-center">
        <p className="font-display text-2xl font-bold text-white">SCHOOLTYPE</p>
        <p className="text-slate-400">{error || 'Person not found'}</p>
        <Link to="/" className="text-sm text-sky-400 hover:text-sky-300">
          Go to home
        </Link>
      </div>
    );
  }

  const isStudent = data.type === 'student' || (!data.type && data.class);
  const subtitle = isStudent
    ? data.class
    : data.role || (data.type === 'staff' ? 'Staff' : data.type === 'non-staff' ? 'Non-staff' : null);

  const detailRows = [
    isStudent && data.roll_number
      ? { Icon: Hash, label: 'Student ID', value: data.roll_number }
      : null,
    !isStudent && data.role
      ? { Icon: Briefcase, label: 'Role', value: data.role }
      : null,
    data.skills
      ? { Icon: Trophy, label: 'Skills', value: data.skills }
      : null,
  ].filter(Boolean);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 font-sans text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(52, 152, 219, 0.2), transparent 55%), #020617',
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col px-5 py-8">
        <header className="mb-8 text-center">
          <p className="font-display text-xl font-extrabold tracking-tight text-white">SCHOOLTYPE</p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
            {isStudent ? 'Student ID' : data.type === 'staff' ? 'Staff ID' : 'School ID'}
          </p>
        </header>

        <div className="overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900/70 shadow-2xl">
          <div className="border-b border-slate-700/80 bg-slate-800/50 px-6 py-5 text-center">
            {data.school_logo_url ? (
              <img
                src={data.school_logo_url}
                alt=""
                className="mx-auto mb-3 h-12 w-12 rounded-xl object-cover"
              />
            ) : null}
            <p className="font-display text-lg font-bold text-white">{data.school_name}</p>
          </div>

          <div className="flex flex-col items-center px-6 pb-8 pt-8">
            {data.photo_url ? (
              <img
                src={data.photo_url}
                alt={data.name}
                className="h-44 w-36 rounded-2xl border-2 border-slate-600 object-cover shadow-lg"
              />
            ) : (
              <div className="flex h-44 w-36 flex-col items-center justify-center rounded-2xl border-2 border-slate-600 bg-slate-800">
                <User className="h-12 w-12 text-slate-500" />
              </div>
            )}

            <h1 className="mt-5 font-display text-2xl font-bold text-white">{data.name}</h1>
            {subtitle && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3 py-1 text-sm text-sky-200">
                {isStudent ? <GraduationCap className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />}
                {subtitle}
              </p>
            )}
          </div>

          {detailRows.length > 0 ? (
            <div className="divide-y divide-slate-700/80 border-t border-slate-700/80">
              {detailRows.map(({ Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3 px-6 py-4">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="whitespace-pre-wrap text-slate-100">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {data.locked ? (
          <p className="mt-6 text-center text-sm text-slate-400">
            {data.hint || 'Ask the school desk to scan this card. Contact numbers and fees stay behind login.'}
          </p>
        ) : null}

        <p className="mt-auto pt-8 text-center text-xs text-slate-600">
          If you found this card, please return it to the school · SCHOOLTYPE
        </p>
      </div>
    </div>
  );
};

export default StudentPublicId;
