import React, { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { GraduationCap, Phone, Briefcase, School, ArrowLeft } from 'lucide-react';

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'ID';
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function phoneHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

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
      <div className="found-id-page">
        <p className="found-id-muted">Loading ID…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="found-id-page found-id-page--center">
        <p className="found-id-brand">SCHOOLTYPE</p>
        <p className="found-id-muted">{error || 'Person not found'}</p>
        <Link to="/" className="found-id-home">
          <ArrowLeft className="h-4 w-4" />
          Go to home
        </Link>
      </div>
    );
  }

  const isStudent = data.type === 'student' || (!data.type && data.class);
  const cardKind = isStudent ? 'Student ID' : data.type === 'staff' ? 'Staff ID' : 'School ID';
  const classOrRole = isStudent
    ? data.class
    : data.role || (data.type === 'staff' ? 'Staff' : data.type === 'non-staff' ? 'Non-staff' : null);
  const parentPhone = data.parent_phone || '';
  const callLink = phoneHref(parentPhone);

  return (
    <div className="found-id-page">
      <header className="found-id-top">
        <p className="found-id-brand">SCHOOLTYPE</p>
        <p className="found-id-kicker">Found {cardKind}</p>
      </header>

      <article className="found-id-card">
        <div className="found-id-school">
          {data.school_logo_url ? (
            <img src={data.school_logo_url} alt="" className="found-id-logo" />
          ) : (
            <span className="found-id-logo found-id-logo--mark">
              <School className="h-5 w-5" />
            </span>
          )}
          <div>
            <p className="found-id-label">School</p>
            <h2 className="found-id-school-name">{data.school_name || 'School'}</h2>
          </div>
        </div>

        <div className="found-id-person">
          <span className="found-id-mono" aria-hidden>
            {initialsFromName(data.name)}
          </span>
          <div className="min-w-0">
            <p className="found-id-label">Name</p>
            <h1 className="found-id-name">{data.name}</h1>
          </div>
        </div>

        <dl className="found-id-facts">
          {classOrRole ? (
            <div className="found-id-fact">
              {isStudent ? <GraduationCap className="found-id-icon" /> : <Briefcase className="found-id-icon" />}
              <div>
                <dt>{isStudent ? 'Class' : 'Role'}</dt>
                <dd>{classOrRole}</dd>
              </div>
            </div>
          ) : null}

          {isStudent ? (
            <div className="found-id-fact">
              <Phone className="found-id-icon" />
              <div>
                <dt>Parent contact</dt>
                <dd>
                  {data.parent_name ? <span className="found-id-parent-name">{data.parent_name}</span> : null}
                  {parentPhone ? (
                    callLink ? (
                      <a className="found-id-phone" href={callLink}>
                        {parentPhone}
                      </a>
                    ) : (
                      <span>{parentPhone}</span>
                    )
                  ) : (
                    <span className="found-id-empty">No parent number on file</span>
                  )}
                </dd>
              </div>
            </div>
          ) : null}
        </dl>
      </article>

      <p className="found-id-return">
        If you found this ID, please return it to <strong>{data.school_name || 'the school'}</strong>
        {parentPhone ? ' or call the parent contact above.' : '.'}
      </p>
    </div>
  );
};

export default StudentPublicId;
