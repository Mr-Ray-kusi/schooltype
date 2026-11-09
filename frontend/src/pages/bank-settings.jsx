import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Check,
  Landmark,
  Smartphone,
  Star,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/authcontext';
import ConfirmTypedDeleteModal from '../components/ConfirmTypedDeleteModal';

const emptyForm = {
  type: 'mobile_money',
  label: '',
  account_name: '',
  account_number: '',
  bank_code: '',
  bank_name: '',
  is_default: true,
};

const fieldClass =
  'w-full rounded-xl border border-slate-600/80 bg-slate-950/60 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-primary-500/60 focus:ring-2 focus:ring-primary-500/30';

const BankSettings = () => {
  const { isSuperAdmin } = useAuth();
  const walletPath = isSuperAdmin ? '/super-admin/platform-wallet' : '/school-wallet';
  const [accounts, setAccounts] = useState([]);
  const [banks, setBanks] = useState([]);
  const [momoProviders, setMomoProviders] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paystackConfigured, setPaystackConfigured] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const defaultLabel = (type) => {
    if (type === 'mobile_money') return isSuperAdmin ? 'Platform MoMo' : 'School MoMo';
    return isSuperAdmin ? 'Platform bank account' : 'School bank account';
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [walletRes, bankRes, momoRes] = await Promise.all([
        axios.get('/api/wallet'),
        axios.get('/api/wallet/banks').catch(() => ({ data: { banks: [] } })),
        axios.get('/api/wallet/banks?type=mobile_money').catch(() => ({ data: { banks: [] } })),
      ]);
      setAccounts(walletRes.data.accounts || []);
      setPaystackConfigured(Boolean(walletRes.data.paystack?.configured));
      setBanks(bankRes.data.banks || []);
      setMomoProviders(momoRes.data.banks || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load bank settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const providerOptions = form.type === 'mobile_money' ? momoProviders : banks;
  const isMomo = form.type === 'mobile_money';

  const handleTypeChange = (type) => {
    setForm((prev) => ({
      ...prev,
      type,
      bank_code: '',
      bank_name: '',
      account_number: '',
      label: defaultLabel(type),
    }));
  };

  const handleBankSelect = (code) => {
    const selected = providerOptions.find((b) => String(b.code) === String(code));
    setForm((prev) => ({
      ...prev,
      bank_code: code,
      bank_name: selected?.name || '',
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.account_name.trim() || !form.account_number.trim() || !form.bank_code) {
      toast.error('Fill in account name, number, and bank/MoMo provider');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        label: form.account_name.trim() || defaultLabel(form.type),
      };
      const { data } = await axios.post('/api/wallet/accounts', payload);
      toast.success('Account saved');
      if (data.warning) toast(data.warning, { icon: 'ℹ️' });
      setForm({
        ...emptyForm,
        type: form.type,
        label: defaultLabel(form.type),
      });
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await axios.patch(`/api/wallet/accounts/${id}`, { is_default: true });
      toast.success('Default account updated');
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update');
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete?.id) return;
    setDeletingAccount(true);
    try {
      await axios.delete(`/api/wallet/accounts/${pendingDelete.id}`);
      toast.success('Account removed');
      setPendingDelete(null);
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    } finally {
      setDeletingAccount(false);
    }
  };

  const accountConfirmName = (account) =>
    String(account?.label || account?.account_name || account?.account_number || '').trim() || 'DELETE';

  return (
    <>
<div className="relative min-h-[calc(100vh-3rem)] overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 10% -10%, rgba(52, 152, 219, 0.18), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(39, 174, 96, 0.12), transparent 50%)',
          }}
        />

        <header className="mb-10 animate-[fadeIn_0.45s_ease-out]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-300/90">
                Finance
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
                Bank Settings
              </h1>
            </div>

            <Link
              to={walletPath}
              className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-900/30 transition hover:bg-primary-500"
            >
              <Wallet className="h-4 w-4" />
              {isSuperAdmin ? 'Platform Wallet' : 'School Wallet'}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            {isSuperAdmin && (
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                  paystackConfigured
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    paystackConfigured ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {paystackConfigured ? 'Paystack connected' : 'Paystack keys missing'}
              </span>
            )}
            <span className="text-slate-400">
              {loading
                ? 'Loading accounts…'
                : `${accounts.length} saved account${accounts.length === 1 ? '' : 's'}`}
            </span>
          </div>
        </header>

        <div className="grid items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
          <section className="animate-[fadeIn_0.55s_ease-out]">
            <form
              onSubmit={handleSubmit}
              className="flex h-full flex-col rounded-3xl border border-slate-700/80 bg-slate-900/50 p-6 md:p-8"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Add account
                  </h2>
                </div>
                <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
              </div>

              <div className="mt-6 flex flex-1 flex-col space-y-5">
                <div
                  role="tablist"
                  aria-label="Account type"
                  className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-700 bg-slate-950/50 p-1.5"
                >
                  {[
                    {
                      id: 'mobile_money',
                      label: 'Mobile Money',
                      hint: 'MTN, Telecel, AirtelTigo',
                      icon: Smartphone,
                    },
                    {
                      id: 'bank',
                      label: 'Bank account',
                      hint: 'Ghana bank transfer',
                      icon: Building2,
                    },
                  ].map((opt) => {
                    const active = form.type === opt.id;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => handleTypeChange(opt.id)}
                        className={`rounded-xl px-4 py-3 text-left transition ${
                          active
                            ? 'bg-slate-800 text-white shadow-md ring-1 ring-primary-500/40'
                            : 'text-slate-400 hover:bg-slate-900/80 hover:text-slate-200'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${active ? 'text-primary-300' : ''}`} />
                          <span className="text-sm font-semibold">{opt.label}</span>
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      {isMomo ? 'MoMo provider' : 'Bank'}
                    </label>
                    {providerOptions.length > 0 ? (
                      <select
                        value={form.bank_code}
                        onChange={(e) => handleBankSelect(e.target.value)}
                        className={fieldClass}
                      >
                        <option value="">Select…</option>
                        {providerOptions.map((bank) => (
                          <option key={`${bank.code}-${bank.name}`} value={bank.code}>
                            {bank.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <input
                          value={form.bank_code}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              bank_code: e.target.value,
                              bank_name: e.target.value,
                            }))
                          }
                          placeholder={isMomo ? 'e.g. MTN' : 'Bank code'}
                          className={fieldClass}
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          Provider list unavailable — enter the Paystack code manually.
                        </p>
                      </>
                    )}
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Account Name
                    </label>
                    <input
                      value={form.account_name}
                      onChange={(e) => setForm((p) => ({ ...p, account_name: e.target.value }))}
                      placeholder="Name on account"
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      {isMomo ? 'MoMo number' : 'Account number'}
                    </label>
                    <input
                      value={form.account_number}
                      onChange={(e) => setForm((p) => ({ ...p, account_number: e.target.value }))}
                      placeholder={isMomo ? '0551234567' : '0123456789'}
                      className={fieldClass}
                    />
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700/70 bg-slate-950/40 px-4 py-3 transition hover:border-slate-600">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-500 bg-slate-900 text-primary-600 focus:ring-primary-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-100">Use as default</span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      Prefill this account when loading or withdrawing money.
                    </span>
                  </span>
                </label>

                <div className="mt-auto pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? (
                      'Saving…'
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        Save account
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section className="animate-[fadeIn_0.55s_ease-out]">
            <div className="flex h-full flex-col rounded-3xl border border-slate-700/80 bg-slate-900/50 p-6 md:p-8">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Saved accounts
                  </h2>
                </div>
                <span className="text-xs text-slate-500">
                  {accounts.length} saved
                </span>
              </div>

              <div className="mt-6 flex-1 space-y-3 overflow-y-auto" style={{ maxHeight: '520px' }}>
                {loading ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-24 animate-pulse rounded-2xl border border-slate-700/60 bg-slate-800/40"
                      />
                    ))}
                  </div>
                ) : !accounts.length ? (
                  <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-slate-950/30 px-6 py-12 text-center">
                    <Smartphone className="h-8 w-8 text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-slate-300">No accounts yet</p>
                    <p className="mt-2 text-sm text-slate-500">
                      Add a MoMo or bank account on the left to get started.
                    </p>
                  </div>
                ) : (
                  accounts.map((account) => {
                    const momo = account.type === 'mobile_money';
                    return (
                      <article
                        key={account.id}
                        className="group rounded-2xl border border-slate-700/80 bg-slate-950/40 p-4 transition hover:border-slate-500/80 hover:bg-slate-950/70"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                              momo
                                ? 'bg-sky-500/15 text-sky-300'
                                : 'bg-violet-500/15 text-violet-300'
                            }`}
                          >
                            {momo ? (
                              <Smartphone className="h-5 w-5" />
                            ) : (
                              <Building2 className="h-5 w-5" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate font-semibold text-white">
                                {account.label || account.bank_name || account.type}
                              </h3>
                              {account.is_default && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                                  <Star className="h-3 w-3 fill-current" />
                                  Default
                                </span>
                              )}
                            </div>
                            <p className="mt-1 truncate text-sm text-slate-300">
                              {account.account_name}
                            </p>
                            <p className="mt-1 font-mono text-xs text-slate-500">
                              {momo ? 'MoMo' : 'Bank'} · {account.bank_name || account.bank_code} ·{' '}
                              {account.account_number}
                            </p>

                            <div className="mt-3 flex flex-wrap gap-2">
                              {!account.is_default && (
                                <button
                                  type="button"
                                  onClick={() => handleSetDefault(account.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700"
                                >
                                  <Star className="h-3 w-3" />
                                  Make default
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setPendingDelete(account)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                              >
                                <Trash2 className="h-3 w-3" />
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <ConfirmTypedDeleteModal
        open={Boolean(pendingDelete)}
        title={`Remove ${pendingDelete ? accountConfirmName(pendingDelete) : 'this account'}?`}
        description="This removes the account from bank settings. Type the account name to confirm."
        confirmText={pendingDelete ? accountConfirmName(pendingDelete) : ''}
        actionLabel="Remove account"
        busy={deletingAccount}
        onClose={() => {
          if (!deletingAccount) setPendingDelete(null);
        }}
        onConfirm={handleDelete}
      />

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
</>
  );
};

export default BankSettings;
