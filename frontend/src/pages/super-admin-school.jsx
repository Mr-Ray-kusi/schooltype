import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  CreditCard,
  DollarSign,
  Mail,
  ShieldCheck,
  Snowflake,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FEATURE_LABELS } from '../constants/plans';

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(amount || 0);

const formatDate = (iso, withTime = false) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};

const statusStyles = {
  approved: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  rejected: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
  pending: 'border-amber-500/30 bg-amber-500/15 text-amber-200',
  none: 'border-white/10 bg-white/5 text-zinc-300',
};

const subscriptionStyles = {
  current: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  grace_period: 'border-amber-500/30 bg-amber-500/15 text-amber-200',
  overdue: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
  frozen: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
};

const cardClass = 'rounded-3xl border border-white/10 bg-[#141416] p-5 md:p-6';

const Field = ({ label, children }) => (
  <div>
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
    <div className="mt-1.5 text-sm text-zinc-100">{children}</div>
  </div>
);

const SuperAdminSchool = () => {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const [school, setSchool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingApproval, setUpdatingApproval] = useState(false);
  const [updatingSubscription, setUpdatingSubscription] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchSchool();
  }, [schoolId]);

  const fetchSchool = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/super-admin/schools/${schoolId}`);
      setSchool(response.data);
    } catch (error) {
      console.error('Error fetching school:', error);
      toast.error(error.response?.data?.error || 'Failed to load school');
      navigate('/super-admin');
    } finally {
      setLoading(false);
    }
  };

  const handleApprovalChange = async (status) => {
    setUpdatingApproval(true);
    try {
      const response = await axios.patch(`/api/super-admin/schools/${schoolId}/approval`, { status });
      setSchool(response.data);
      toast.success(status === 'approved' ? 'Plan approved — features unlocked' : 'Approval status updated');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update approval');
    } finally {
      setUpdatingApproval(false);
    }
  };

  const handleFreezeToggle = async () => {
    setUpdatingSubscription(true);
    try {
      const response = await axios.patch(`/api/super-admin/schools/${schoolId}/subscription`, {
        frozen: !school.subscription_frozen,
      });
      setSchool(response.data);
      toast.success(school.subscription_frozen ? 'Account unfrozen' : 'Account frozen — features locked');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update subscription');
    } finally {
      setUpdatingSubscription(false);
    }
  };

  const handleDeleteSchool = async () => {
    if (deleteConfirmName.trim() !== school.name) {
      toast.error('School name does not match');
      return;
    }
    setDeleting(true);
    try {
      await axios.delete(`/api/super-admin/schools/${schoolId}`, {
        data: { confirmName: deleteConfirmName.trim() },
      });
      toast.success('School account deleted');
      navigate('/super-admin');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete school');
    } finally {
      setDeleting(false);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(school.email || '');
      toast.success('Email copied');
    } catch {
      toast.error('Could not copy email');
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-400">Loading school details...</div>
    );
  }

  if (!school) return null;

  const status = school.plan_status || (school.payment_plan ? 'pending' : 'none');
  const features =
    school.plan_approved && school.subscription_active !== false
      ? school.plan_features
      : school.pending_plan_features;
  const featuresUnlocked = school.plan_approved && school.subscription_active !== false;
  const subStatus = school.subscription_frozen
    ? 'frozen'
    : !school.subscription_active && school.plan_approved
      ? 'overdue'
      : school.subscription_in_grace
        ? 'grace_period'
        : 'current';
  const subLabel =
    subStatus === 'grace_period'
      ? `Grace · ${school.subscription_days_past_due || 0}d overdue`
      : subStatus.replace('_', ' ');

  const usage = [
    { label: 'Students', value: school.stats?.students ?? 0, icon: Users },
    { label: 'Staff', value: school.stats?.staff ?? 0, icon: Briefcase },
    { label: 'Non-staff', value: school.stats?.nonStaff ?? 0, icon: UserCog },
    { label: 'Total paid', value: formatMoney(school.total_paid), icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/super-admin"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/70 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-white/20 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        All schools
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#141416] p-5 shadow-[0_0_80px_rgba(52,152,219,0.08)] md:p-7">
        <div className="chart-animated-bg pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative z-10 space-y-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              {school.logo_url ? (
                <img
                  src={school.logo_url}
                  alt={`${school.name} logo`}
                  className="h-16 w-16 rounded-2xl border border-white/10 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-violet-500/15">
                  <Building2 className="h-8 w-8 text-violet-300" />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">{school.name}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
                  <span>{school.email}</span>
                  {school.email_verified ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verified
                    </span>
                  ) : null}
                  <span>· Registered {formatDate(school.created_at)}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${
                      statusStyles[status] || statusStyles.none
                    }`}
                  >
                    {status === 'none' ? 'Awaiting plan' : status}
                  </span>
                  {school.plan_approved ? (
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${
                        subscriptionStyles[subStatus] || subscriptionStyles.current
                      }`}
                    >
                      {subLabel}
                    </span>
                  ) : null}
                  {school.subscription_active === false ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Features locked
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              {status !== 'approved' ? (
                <>
                  <button
                    type="button"
                    disabled={!school.payment_plan || updatingApproval}
                    onClick={() => handleApprovalChange('approved')}
                    className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Approve plan
                  </button>
                  <button
                    type="button"
                    disabled={updatingApproval}
                    onClick={() => handleApprovalChange('rejected')}
                    className="rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={updatingApproval}
                  onClick={() => handleApprovalChange('pending')}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50"
                >
                  Revoke approval
                </button>
              )}
              {school.plan_approved ? (
                <button
                  type="button"
                  disabled={updatingSubscription}
                  onClick={handleFreezeToggle}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                    school.subscription_frozen
                      ? 'border border-white/10 bg-white/5 text-zinc-100'
                      : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'
                  }`}
                >
                  <Snowflake className="h-4 w-4" />
                  {school.subscription_frozen ? 'Unfreeze' : 'Freeze'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {usage.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-white">{item.value}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <section className={cardClass}>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-400">
              <Mail className="h-4 w-4 text-violet-300" />
              Account
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Login email">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-zinc-100">{school.email}</span>
                  <button
                    type="button"
                    onClick={copyEmail}
                    className="rounded-lg border border-white/10 p-1 text-zinc-400 hover:text-white"
                    aria-label="Copy email"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Field>
              <Field label="Registered">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-zinc-500" />
                  {formatDate(school.created_at)}
                </span>
              </Field>
              <Field label="Password">
                <p className="text-zinc-400">
                  Stored as a secure hash only. Use password reset if the school admin is locked out.
                </p>
              </Field>
            </div>
          </section>

          <section className={cardClass}>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-400">
              <CreditCard className="h-4 w-4 text-violet-300" />
              Payment plan
            </h2>
            {school.payment_plan ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/50 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-lg font-semibold text-white">{school.plan_name}</p>
                  {school.plan_price != null ? (
                    <p className="font-semibold text-emerald-300">{formatMoney(school.plan_price)}/year</p>
                  ) : null}
                </div>
                {school.plan_selected_at ? (
                  <p className="mt-1 text-sm text-zinc-500">Selected {formatDate(school.plan_selected_at)}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-5 text-sm text-amber-200">
                This school has not selected a payment plan yet. They must choose one before you can approve.
              </p>
            )}
            <p className="mt-3 text-xs text-zinc-500">
              Plans are chosen by the school. Platform admins approve them; they cannot change the plan.
            </p>
          </section>

          <section className={cardClass}>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-400">
              <ShieldCheck className="h-4 w-4 text-violet-300" />
              Plan features
            </h2>
            {features?.length ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {features.map((feature) => (
                  <span
                    key={feature}
                    className={`rounded-full px-3 py-1 text-xs ${
                      featuresUnlocked
                        ? 'bg-violet-500/15 text-violet-200'
                        : 'border border-white/10 bg-white/5 text-zinc-400'
                    }`}
                  >
                    {FEATURE_LABELS[feature] || feature.replace(/-/g, ' ')}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-5 text-sm text-zinc-500">No features until the school selects a payment plan.</p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {school.plan_approved ? (
            <section className={cardClass}>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-400">
                <DollarSign className="h-4 w-4 text-violet-300" />
                Subscription & billing
              </h2>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="col-span-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200/70">
                    Total paid
                  </p>
                  <p className="mt-1 text-2xl font-bold text-emerald-300">{formatMoney(school.total_paid)}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {school.plan_price
                      ? `${formatMoney(school.plan_price)} per year · updates when Paystack payment succeeds`
                      : 'Updates when Paystack payment succeeds'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-zinc-950/50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Since</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDate(school.subscription_started_at)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-zinc-950/50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Period start</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDate(school.last_payment_at)}</p>
                </div>
                <div className="col-span-2 rounded-2xl border border-white/10 bg-zinc-950/50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Period ends</p>
                  <p className="mt-1 text-sm font-medium text-white">{formatDate(school.next_payment_due)}</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-zinc-400">
                Yearly billing from the subscription date. Successful signup and renewal payments on Paystack add to
                total revenue and move the due date forward one year. Features lock{' '}
                {school.subscription_grace_days || 5} days after the period ends if payment is missing.
              </p>

              {school.payment_records?.length > 0 ? (
                <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                  <p className="border-b border-white/10 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Payment history
                  </p>
                  <ul className="max-h-52 divide-y divide-white/5 overflow-y-auto">
                    {school.payment_records.map((record, index) => (
                      <li
                        key={`${record.recorded_at}-${index}`}
                        className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                      >
                        <div>
                          <p className="font-medium text-white">{record.plan_name || 'Subscription'}</p>
                          <p className="text-xs text-zinc-500">{formatDate(record.recorded_at, true)}</p>
                        </div>
                        <span className="shrink-0 font-semibold text-emerald-300">{formatMoney(record.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : (
            <section className={cardClass}>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-400">
                <DollarSign className="h-4 w-4 text-violet-300" />
                Subscription & billing
              </h2>
              <p className="mt-5 text-sm text-zinc-400">
                Billing starts after you approve the school&apos;s selected plan. Approve from the header to unlock
                features. Revenue updates when Paystack payment succeeds.
              </p>
            </section>
          )}

          <section className="rounded-3xl border border-rose-500/25 bg-[#141416] p-5 md:p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-rose-300">
              <Trash2 className="h-4 w-4" />
              Delete school
            </h2>
            <p className="mt-3 text-sm text-zinc-400">
              Permanently delete this school and its students, staff, attendance, and messages. This cannot be undone.
            </p>
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="mt-4 rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/20"
            >
              Delete school account
            </button>
          </section>
        </div>
      </div>

      {showDeleteModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-[#141416] p-6">
            <h3 className="text-lg font-semibold text-white">Confirm deletion</h3>
            <p className="text-sm text-zinc-400">
              Type <span className="font-medium text-white">{school.name}</span> to permanently delete this school
              account.
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(event) => setDeleteConfirmName(event.target.value)}
              placeholder="School name"
              className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-rose-400/50"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmName('');
                }}
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || deleteConfirmName.trim() !== school.name}
                onClick={handleDeleteSchool}
                className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SuperAdminSchool;
