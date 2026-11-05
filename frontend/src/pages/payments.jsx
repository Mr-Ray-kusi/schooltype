import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { RefreshCw, Wallet } from 'lucide-react';
import PaginationBar from '../components/PaginationBar';

const PAYMENT_ROW_HEIGHT = 48;
const PAYMENT_HEAD_HEIGHT = 36;

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const Payments = () => {
  const [people, setPeople] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState('all');
  const [phones, setPhones] = useState({});
  const [busyId, setBusyId] = useState('');
  const [pending, setPending] = useState(null);
  const [alert, setAlert] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/payroll');
      setPeople(data.people || []);
      setWallet(data.wallet || null);
      setPhones((current) => {
        const next = { ...current };
        for (const person of data.people || []) {
          const key = `${person.kind}:${person.id}`;
          if (person.momo_phone) next[key] = person.momo_phone;
        }
        return next;
      });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load salary payments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => (group === 'all' ? people : people.filter((person) => person.kind === group)),
    [people, group]
  );

  useEffect(() => {
    setPage(1);
  }, [group]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => {
      const next = Math.max(1, Math.floor((el.clientHeight - PAYMENT_HEAD_HEIGHT) / PAYMENT_ROW_HEIGHT));
      setPageSize((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible.length, pending, loading]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize) || 1);
  const safePage = Math.min(page, pageCount);
  const paged = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const readyCount = visible.filter((person) => person.salary >= 1 && (phones[`${person.kind}:${person.id}`] || person.momo_phone)).length;

  const saveNonStaffPhone = async (person) => {
    if (person.kind !== 'non-staff') return;
    const key = `${person.kind}:${person.id}`;
    const next = String(phones[key] ?? person.momo_phone ?? '').trim();
    const current = String(person.momo_phone || '').trim();
    if (next === current) return;
    try {
      const { data } = await axios.patch('/api/payroll/phone', {
        kind: person.kind,
        person_id: person.id,
        momo_phone: next,
      });
      const saved = data.momo_phone || '';
      setPeople((rows) =>
        rows.map((row) => (row.kind === person.kind && row.id === person.id ? { ...row, momo_phone: saved } : row))
      );
      setPhones((currentPhones) => ({ ...currentPhones, [key]: saved }));
      toast.success(`Saved ${person.name}'s MoMo number`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save that MoMo number');
    }
  };

  const startPay = async (person) => {
    const key = `${person.kind}:${person.id}`;
    const momo_phone = phones[key] || person.momo_phone;
    setBusyId(key);
    setAlert('');
    try {
      const { data } = await axios.post('/api/payroll/pay', {
        kind: person.kind,
        person_id: person.id,
        momo_phone,
        amount: person.salary,
      });
      setPending({ ...data, mode: 'one', name: person.name });
      toast('Confirm this salary. Money leaves the wallet only after the second step.');
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not start this salary payment');
    } finally {
      setBusyId('');
    }
  };

  const startPayAll = async () => {
    setBusyId('all');
    setAlert('');
    try {
      const { data } = await axios.post('/api/payroll/pay-all', { kind: group, phones });
      setPending({ ...data, mode: 'all' });
      toast('Confirm this group payment. Money leaves the wallet only after the second step.');
    } catch (err) {
      setAlert(err.response?.data?.error || 'Could not start group salary payment');
    } finally {
      setBusyId('');
    }
  };

  const confirmPay = async () => {
    if (!pending?.approval_id) return;
    setBusyId('confirm');
    try {
      const { data } = await axios.post(`/api/payroll/pay/${encodeURIComponent(pending.approval_id)}/confirm`);
      const paid = data.paid?.length || 0;
      const failed = data.failed || [];
      if (failed.length && paid) {
        toast.error(`Paid ${paid}. ${failed.length} failed: ${failed.map((row) => row.name).join(', ')}`);
      } else if (failed.length) {
        toast.error(failed[0]?.error || 'Salary payment failed');
      } else {
        toast.success(paid > 1 ? `Paid ${paid} salaries` : 'Salary sent');
      }
      setPending(null);
      setWallet(data.wallet || wallet);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not confirm salary payment');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-5xl flex-col gap-3 overflow-hidden">
      {alert ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="payments-alert-title"
        >
          <div className="w-full max-w-md rounded-t-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-800">
                <Wallet className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 id="payments-alert-title" className="text-lg font-bold text-white">
                  Cannot pay this salary
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-200">{alert}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAlert('')}
              className="mt-6 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
      <header className="flex shrink-0 min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Finance</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white">Payments</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="text-right">
            <span className="block text-[11px] text-slate-500">Wallet</span>
            <strong className="text-sm font-semibold tabular-nums text-white">
              {loading ? '—' : formatGhs(wallet?.available_balance_major)}
            </strong>
          </p>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/70">
        <div className="flex shrink-0 flex-col gap-2 border-b border-slate-800 px-4 py-2.5 md:flex-row md:items-center md:justify-between md:px-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Salaries</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {readyCount} ready to pay in this list. Pay one person or everyone ready. Staff numbers come from
              the staff portal. Enter non-staff numbers here — they have no portal.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'staff', label: 'Staff' },
              { id: 'non-staff', label: 'Non-staff' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setGroup(opt.id);
                  setPage(1);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  group === opt.id ? 'bg-white text-slate-900' : 'border border-slate-600 text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              disabled={Boolean(busyId) || !readyCount}
              onClick={startPayAll}
              className="rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {busyId === 'all' ? 'Starting…' : 'Pay all ready'}
            </button>
          </div>
        </div>

        {pending ? (
          <div className="shrink-0 border-b border-slate-800 px-4 py-2.5 md:px-5">
            <p className="rounded-xl border border-amber-700 bg-amber-100 px-4 py-3 text-sm font-medium text-amber-950">
              {pending.display_text}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyId === 'confirm'}
                onClick={confirmPay}
                className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-50"
              >
                {busyId === 'confirm' ? 'Sending…' : 'Confirm payment'}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="min-h-0 flex-1 space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-800/70" />
            ))}
          </div>
        ) : !visible.length ? (
          <p className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-slate-400">
            No staff or non-staff records yet.
          </p>
        ) : (
          <>
            <div ref={listRef} className="min-h-0 flex-1 overflow-hidden">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-950/50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold md:px-4">Name</th>
                    <th className="px-3 py-2 font-semibold md:px-4">Role</th>
                    <th className="px-3 py-2 font-semibold md:px-4">MoMo number</th>
                    <th className="px-3 py-2 text-right font-semibold md:px-4">Salary</th>
                    <th className="px-3 py-2 text-right font-semibold md:px-4">Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((person) => {
                    const key = `${person.kind}:${person.id}`;
                    return (
                      <tr key={key} className="border-t border-slate-800" style={{ height: PAYMENT_ROW_HEIGHT }}>
                        <td className="px-3 md:px-4">
                          <p className="truncate font-medium text-white">{person.name}</p>
                          <p className="truncate text-[11px] leading-none text-slate-500">
                            {person.kind === 'non-staff' ? 'Non-staff' : 'Staff'}
                          </p>
                        </td>
                        <td className="truncate px-3 text-slate-300 md:px-4">{person.role || '—'}</td>
                        <td className="px-3 md:px-4">
                          <input
                            value={phones[key] || ''}
                            onChange={(event) => setPhones((current) => ({ ...current, [key]: event.target.value }))}
                            onBlur={() => saveNonStaffPhone(person)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                            }}
                            placeholder={person.kind === 'non-staff' ? 'Enter MoMo number' : '024xxxxxxx'}
                            title={
                              person.kind === 'non-staff'
                                ? 'Non-staff have no portal. Type their MoMo number and it will save.'
                                : 'Filled from the staff portal. You can override it here for this payment.'
                            }
                            className="h-8 w-36 rounded-lg border border-slate-600 bg-slate-950/60 px-2.5 text-sm text-white"
                          />
                        </td>
                        <td className="px-3 text-right tabular-nums text-white md:px-4">
                          {person.salary > 0 ? formatGhs(person.salary) : '—'}
                        </td>
                        <td className="px-3 text-right md:px-4">
                          <button
                            type="button"
                            disabled={Boolean(busyId) || person.salary < 1}
                            onClick={() => startPay(person)}
                            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {busyId === key ? '…' : 'Pay'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 border-t border-slate-800 px-4 py-2 md:px-5">
              <PaginationBar
                page={safePage}
                total={visible.length}
                limit={pageSize}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default Payments;
