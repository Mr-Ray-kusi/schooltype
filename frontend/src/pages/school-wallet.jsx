import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Building2,
  Clock3,
  Download,
  Landmark,
  RefreshCw,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/authcontext';

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const escapeCsv = (value) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const downloadWalletCsv = (rows, filename) => {
  const header = ['Date', 'Type', 'Amount (GHS)', 'Status', 'Channel', 'Reference', 'Description'];
  const lines = [
    header.join(','),
    ...rows.map((tx) =>
      [
        escapeCsv(tx.created_at ? new Date(tx.created_at).toLocaleString() : ''),
        escapeCsv(tx.type || ''),
        escapeCsv(Number(tx.amount_major ?? 0).toFixed(2)),
        escapeCsv(tx.status || ''),
        escapeCsv(tx.channel || ''),
        escapeCsv(tx.reference || ''),
        escapeCsv(tx.description || ''),
      ].join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const fieldClass =
  'w-full rounded-xl border border-slate-600/80 bg-slate-950/60 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-primary-500/60 focus:ring-2 focus:ring-primary-500/30';

const statusStyles = {
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  pending: 'bg-amber-500/15 text-amber-200 border-amber-500/25',
  processing: 'bg-sky-500/15 text-sky-200 border-sky-500/25',
};

const isCredit = (tx) =>
  tx.type === 'deposit' ||
  tx.type === 'credit' ||
  tx.metadata?.kind === 'school_fee' ||
  Boolean(tx.source_label);

const isFeePaid = (tx) =>
  tx.metadata?.kind === 'school_fee' ||
  tx.source_label === 'Paid online' ||
  tx.source_label === 'Cashed' ||
  /school fees/i.test(String(tx.description || ''));

const isPayout = (tx) =>
  tx.type === 'withdrawal' ||
  tx.metadata?.kind === 'salary' ||
  tx.metadata?.wallet_action === 'withdrawal';

const isDepositTx = (tx) => isCredit(tx) && !isFeePaid(tx);

const SchoolWallet = ({ viewOnly = false } = {}) => {
  const { isSuperAdmin } = useAuth();
  const bankSettingsPath = isSuperAdmin ? '/super-admin/bank-settings' : '/bank-settings';
  const title = isSuperAdmin ? 'Platform Wallet' : 'School Wallet';
  const [searchParams, setSearchParams] = useSearchParams();
  const [wallet, setWallet] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [paystack, setPaystack] = useState({ configured: false, currency: 'GHS' });
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [momoHint, setMomoHint] = useState('');
  const [action, setAction] = useState(isSuperAdmin ? 'withdraw' : 'deposit');
  const [downloading, setDownloading] = useState(false);
  const [pendingWithdraw, setPendingWithdraw] = useState(null);
  const [txFilter, setTxFilter] = useState('all');

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) || null,
    [accounts, accountId]
  );

  const momoAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'mobile_money'),
    [accounts]
  );

  const selectableAccounts = action === 'deposit' ? momoAccounts : accounts;

  const visibleTransactions = useMemo(() => {
    if (txFilter === 'fees') return transactions.filter(isFeePaid);
    if (txFilter === 'deposit') return transactions.filter(isDepositTx);
    if (txFilter === 'payout') return transactions.filter(isPayout);
    return transactions;
  }, [transactions, txFilter]);

  useEffect(() => {
    if (!selectableAccounts.length) {
      setAccountId('');
      return;
    }
    const stillValid = selectableAccounts.some((a) => a.id === accountId);
    if (!stillValid) {
      const preferred =
        selectableAccounts.find((a) => a.is_default)?.id || selectableAccounts[0].id;
      setAccountId(preferred);
    }
  }, [action, selectableAccounts, accountId]);

  const loadWallet = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/wallet');
      setWallet(data.wallet);
      setAccounts(data.accounts || []);
      setTransactions(data.transactions || []);
      setPaystack(data.paystack || { configured: false });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    const ref = searchParams.get('reference') || searchParams.get('trxref');
    if (!ref) return;

    (async () => {
      try {
        await axios.post(`/api/wallet/verify/${encodeURIComponent(ref)}`);
        toast.success('Deposit verified');
        await loadWallet();
      } catch (err) {
        toast.error(err.response?.data?.error || 'Could not verify deposit');
      } finally {
        searchParams.delete('reference');
        searchParams.delete('trxref');
        setSearchParams(searchParams, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams, loadWallet]);

  const handleDeposit = async () => {
    if (!momoAccounts.length) {
      toast.error('Add a MoMo account in Bank Settings first');
      return;
    }
    if (!accountId) {
      toast.error('Select a MoMo account');
      return;
    }
    if (selectedAccount?.type !== 'mobile_money') {
      toast.error('Load money works with MoMo only');
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1) {
      toast.error('Enter an amount of at least 1.00');
      return;
    }

    setBusy(true);
    setMomoHint('');
    try {
      const { data } = await axios.post('/api/wallet/deposit', {
        account_id: accountId,
        amount: value,
      });

      if (data.status === 'success') {
        toast.success('Deposit credited to wallet');
        setAmount('');
        setMomoHint('');
        await loadWallet();
        return;
      }

      const hint =
        data.display_text ||
        'Approve the MoMo payment prompt on your phone to complete this deposit.';
      setMomoHint(hint);
      toast.success('Payment sent — confirm on your phone');

      const reference = data.reference;
      for (let i = 0; i < 15; i += 1) {
        await new Promise((r) => setTimeout(r, 4000));
        const verified = await axios.post(`/api/wallet/verify/${encodeURIComponent(reference)}`);
        if (verified.data.transaction?.status === 'success') {
          toast.success('Payment confirmed — wallet credited');
          setAmount('');
          setMomoHint('');
          await loadWallet();
          return;
        }
        if (verified.data.transaction?.status === 'failed') {
          toast.error('Payment failed or was declined');
          setMomoHint('');
          await loadWallet();
          return;
        }
      }
      toast('Still waiting for phone confirmation. Keep this page open or refresh later.', {
        icon: '⏳',
      });
      await loadWallet();
    } catch (err) {
      const raw = err.response?.data?.error || err.response?.data?.message || '';
      // Paystack's normal MoMo start message — treat as prompt sent, not failure
      if (/charge attempted/i.test(String(raw))) {
        setMomoHint(
          'A payment prompt was sent to your MoMo number. Approve it on your phone to complete the deposit.'
        );
        toast.success('Payment sent — confirm on your phone');
        await loadWallet();
        return;
      }
      toast.error(raw || 'Deposit failed');
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!accounts.length) {
      toast.error('Add a bank or MoMo account in Bank Settings first');
      return;
    }
    if (!accountId) {
      toast.error('Select an account');
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1) {
      toast.error('Enter an amount of at least 1.00');
      return;
    }

    if (pendingWithdraw && pendingWithdraw.amount === value && pendingWithdraw.account_id === accountId) {
      setBusy(true);
      try {
        const { data } = await axios.post(`/api/wallet/withdraw/${encodeURIComponent(pendingWithdraw.approval_id)}/confirm`);
        toast.success(
          data.status === 'success'
            ? 'Payment received, money sent. Open the receipt in transactions.'
            : 'Withdrawal submitted after confirmation'
        );
        setAmount('');
        setPendingWithdraw(null);
        await loadWallet();
      } catch (err) {
        toast.error(err.response?.data?.error || 'Withdrawal failed');
        await loadWallet();
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const { data } = await axios.post('/api/wallet/withdraw', {
        account_id: accountId,
        amount: value,
        reason: isSuperAdmin ? 'Platform wallet withdrawal' : 'School wallet withdrawal',
      });
      if (data.status === 'awaiting_confirmation') {
        setPendingWithdraw({
          approval_id: data.approval_id,
          amount: value,
          account_id: accountId,
        });
        toast('Confirm this withdrawal. Money leaves the wallet only after you press Withdraw again.');
        return;
      }
      toast.success(data.status === 'success' ? 'Withdrawal completed' : 'Withdrawal submitted');
      setAmount('');
      await loadWallet();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Withdrawal failed');
      await loadWallet();
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadRecords = async (filter = 'all') => {
    setDownloading(true);
    try {
      let rows = transactions;
      try {
        const { data } = await axios.get('/api/wallet/transactions');
        if (Array.isArray(data.transactions) && data.transactions.length) {
          rows = data.transactions;
        }
      } catch {
        // Fall back to already-loaded recent transactions
      }

      if (filter === 'fees') rows = rows.filter(isFeePaid);
      else if (filter === 'deposit') rows = rows.filter(isDepositTx);
      else if (filter === 'payout') rows = rows.filter(isPayout);

      if (!rows.length) {
        toast.error(
          filter === 'fees'
            ? 'No fee payment records to download'
            : filter === 'deposit'
              ? 'No deposit records to download'
              : filter === 'payout'
                ? 'No payout records to download'
                : 'No wallet records to download'
        );
        return;
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const label =
        filter === 'fees'
          ? 'fees'
          : filter === 'deposit'
            ? 'deposits'
            : filter === 'payout'
              ? 'payouts'
              : 'transactions';
      const prefix = isSuperAdmin ? 'platform-wallet' : 'school-wallet';
      downloadWalletCsv(rows, `${prefix}-${label}-${stamp}.csv`);
      toast.success(`Downloaded ${rows.length} record${rows.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to download records');
    } finally {
      setDownloading(false);
    }
  };

  const handleSubmit = () => {
    if (action === 'deposit') handleDeposit();
    else handleWithdraw();
  };

  const formatWhen = (value) => {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Accra',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  };

  const balanceRows = isSuperAdmin
    ? [
        { label: 'Available', value: wallet?.available_balance_major, tone: 'text-white' },
        { label: 'Pending', value: wallet?.pending_balance_major, tone: 'text-slate-100' },
      ]
    : [
        { label: 'Available', value: wallet?.available_balance_major, tone: 'text-white' },
        { label: 'Paid online', value: wallet?.paid_online_major, tone: 'text-sky-200' },
        { label: 'Cashed', value: wallet?.cashed_major, tone: 'text-amber-200' },
        { label: 'Pending', value: wallet?.pending_balance_major, tone: 'text-slate-100' },
      ];

  return (
    <div className="min-w-0 max-w-5xl space-y-5 pb-8">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Finance</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {isSuperAdmin ? (
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                  paystack.configured
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${paystack.configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {paystack.configured ? 'Paystack ready' : 'Paystack not configured'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/70 px-2.5 py-1 text-xs text-slate-300">
                Load with MoMo · withdraw to MoMo or bank
              </span>
            )}
            <span className="text-xs text-slate-500">{paystack.currency || 'GHS'}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            type="button"
            onClick={loadWallet}
            disabled={loading || busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {viewOnly ? null : (
            <Link
              to={bankSettingsPath}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary-500"
            >
              <Landmark className="h-4 w-4" />
              Bank Settings
              <ArrowRight className="hidden h-4 w-4 sm:block" />
            </Link>
          )}
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 md:px-5">
          <h2 className="text-sm font-semibold text-white">Balance</h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Wallet className="h-3.5 w-3.5" />
            {paystack.currency || 'GHS'}
          </span>
        </div>
        <div>
          {balanceRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3 last:border-b-0 md:px-5"
            >
              <span className="text-sm text-slate-400">{row.label}</span>
              <strong className={`text-base font-semibold tabular-nums md:text-lg ${row.tone}`}>
                {loading ? '—' : formatGhs(row.value)}
              </strong>
            </div>
          ))}
        </div>
        {isSuperAdmin ? (
          <p className="border-t border-slate-800 px-4 py-3 text-xs text-slate-500 md:px-5">
            Signup, renewals, and SMS unit sales credit this wallet.
          </p>
        ) : null}
      </section>

      {viewOnly ? (
        <p className="rounded-2xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
          You can see balances and records. Only the school account can deposit or withdraw.
        </p>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
          <div className="border-b border-slate-800 px-4 py-3 md:px-5">
            <h2 className="text-sm font-semibold text-white">Move money</h2>
          </div>
          <div className="space-y-4 px-4 py-4 md:px-5">
            <div
              role="tablist"
              aria-label="Wallet action"
              className={`grid gap-2 ${isSuperAdmin ? 'grid-cols-1' : 'grid-cols-2'}`}
            >
              {[
                !isSuperAdmin && {
                  id: 'deposit',
                  label: 'Load money',
                  hint: 'MoMo · confirm on the phone',
                  icon: ArrowDownToLine,
                },
                {
                  id: 'withdraw',
                  label: 'Withdraw',
                  hint: 'Send to MoMo or bank',
                  icon: ArrowUpFromLine,
                },
              ]
                .filter(Boolean)
                .map((opt) => {
                  const active = action === opt.id;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setAction(opt.id);
                        setMomoHint('');
                        setPendingWithdraw(null);
                      }}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        active
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-white'
                          : 'border-slate-700 bg-slate-950/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${active ? 'text-emerald-300' : ''}`} />
                        <span className="text-sm font-semibold">{opt.label}</span>
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">{opt.hint}</span>
                    </button>
                  );
                })}
            </div>
          {(action === 'deposit' ? !momoAccounts.length : !accounts.length) ? (
            <div className="py-6 text-center">
              <Smartphone className="mx-auto h-7 w-7 text-slate-500" />
              <p className="mt-3 text-sm font-medium text-slate-200">
                {action === 'deposit' ? 'No MoMo account yet' : 'No payout account yet'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {action === 'deposit'
                  ? 'Save a Mobile Money account in Bank Settings before loading money.'
                  : 'Save a MoMo or bank account before withdrawing.'}
              </p>
              <Link
                to={bankSettingsPath}
                className="mt-4 inline-flex rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-500"
              >
                Open Bank Settings
              </Link>
            </div>
          ) : (
            <>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    {action === 'deposit' ? 'MoMo account' : 'Payout account'}
                  </label>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={fieldClass}>
                    {selectableAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {(account.label || account.bank_name || account.type) +
                          ` · ${account.account_number}` +
                          (account.is_default ? ' (default)' : '')}
                      </option>
                    ))}
                  </select>
                  {selectedAccount ? (
                    <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                      {selectedAccount.type === 'mobile_money' ? (
                        <Smartphone className="h-3.5 w-3.5 text-sky-300" />
                      ) : (
                        <Building2 className="h-3.5 w-3.5 text-violet-300" />
                      )}
                      {selectedAccount.type === 'mobile_money' ? 'MoMo' : 'Bank'} · {selectedAccount.account_name}
                      {action === 'deposit' ? ' · Approve the prompt on this phone' : ''}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    Amount (GHS)
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                      GHS
                    </span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="100.00"
                      className={`${fieldClass} pl-14 text-lg font-semibold tabular-nums tracking-tight`}
                    />
                  </div>
                </div>
              </div>

              {momoHint ? (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                  <p className="font-medium text-sky-50">Confirm on your phone</p>
                  <p className="mt-1">{momoHint}</p>
                  {busy ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-sky-200/80">
                      <Clock3 className="h-3.5 w-3.5" />
                      Waiting for confirmation… keep your phone nearby.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {pendingWithdraw ? (
                <p className="rounded-xl border border-amber-700 bg-amber-100 px-4 py-3 text-sm font-medium text-amber-950">
                  Press Confirm withdrawal to send {formatGhs(pendingWithdraw.amount)}. Money leaves the wallet only
                  after this second step.
                </p>
              ) : null}

              <button
                type="button"
                disabled={busy}
                onClick={handleSubmit}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 md:w-auto md:min-w-[220px] ${
                  action === 'deposit' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-primary-600 hover:bg-primary-500'
                }`}
              >
                {busy ? (
                  action === 'deposit' ? 'Waiting for phone…' : 'Processing…'
                ) : action === 'deposit' ? (
                  <>
                    <Smartphone className="h-4 w-4" />
                    Load via MoMo
                  </>
                ) : (
                  <>
                    <ArrowUpFromLine className="h-4 w-4" />
                    {pendingWithdraw ? 'Confirm withdrawal' : 'Withdraw'}
                  </>
                )}
              </button>
            </>
          )}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
        <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Activity</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {visibleTransactions.length} record{visibleTransactions.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'fees', label: 'Fees paid' },
              { id: 'deposit', label: 'Deposit' },
              { id: 'payout', label: 'Payouts' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTxFilter(opt.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  txFilter === opt.id
                    ? 'bg-white text-slate-900'
                    : 'border border-slate-600 text-slate-300 hover:border-slate-500'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              disabled={downloading || (!visibleTransactions.length && !loading)}
              onClick={() => handleDownloadRecords(txFilter)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? '…' : 'Download'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-800/70" />
            ))}
          </div>
        ) : !visibleTransactions.length ? (
          <div className="px-4 py-10 text-center md:px-5">
            <Wallet className="mx-auto h-7 w-7 text-slate-500" />
            <p className="mt-3 text-sm font-medium text-slate-200">
              {txFilter === 'all' ? 'No activity yet' : 'No matching records'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {txFilter === 'fees'
                ? 'Fee payments will show here when parents pay online or cash is recorded.'
                : txFilter === 'deposit'
                  ? 'Deposits appear here after money is loaded into the wallet.'
                  : txFilter === 'payout'
                    ? 'Withdrawals and salary payments will show here.'
                    : isSuperAdmin
                      ? 'Successful signup, renewal, and SMS payments appear here.'
                      : 'Load money or collect school fees to see the first record.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-950/50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold md:px-5">Date</th>
                  <th className="px-4 py-2.5 font-semibold md:px-5">Details</th>
                  <th className="px-4 py-2.5 font-semibold md:px-5">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold md:px-5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.map((tx) => {
                  const credit = isCredit(tx);
                  const style = statusStyles[tx.status] || statusStyles.pending;
                  return (
                    <tr key={tx.id} className="border-t border-slate-800">
                      <td className="whitespace-nowrap px-4 py-3 align-top text-slate-400 md:px-5">
                        {formatWhen(tx.created_at)}
                      </td>
                      <td className="min-w-[12rem] px-4 py-3 align-top md:px-5">
                        <p className="font-medium text-white">
                          {tx.description || (credit ? 'Credit' : tx.type)}
                        </p>
                        <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{tx.reference}</p>
                      </td>
                      <td className="px-4 py-3 align-top md:px-5">
                        <div className="flex flex-wrap gap-1.5">
                          {tx.source_label ? (
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                tx.source_label === 'Cashed'
                                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                                  : 'border-sky-500/30 bg-sky-500/10 text-sky-100'
                              }`}
                            >
                              {tx.source_label}
                            </span>
                          ) : null}
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${style}`}>
                            {tx.status}
                          </span>
                        </div>
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right align-top font-semibold tabular-nums md:px-5 ${
                          credit ? 'text-emerald-300' : 'text-slate-100'
                        }`}
                      >
                        {credit ? '+' : '−'}
                        {formatGhs(tx.amount_major)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default SchoolWallet;
