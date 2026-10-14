import React, { useState, useEffect } from 'react';
import { useLocation, Navigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/authcontext';
import {
  Send,
  Reply,
  Mail,
  MessageSquare,
  Clock,
  Wallet,
  Coins,
  X,
  Paperclip,
  Radio,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { staleGet, peekCache, invalidateCache } from '../utils/requestCache';

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fieldClass =
  'w-full rounded-xl border border-slate-600/80 bg-slate-950/60 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-primary-500/60 focus:ring-2 focus:ring-primary-500/30';

const Messages = () => {
  const { hasFeature, hasMessaging } = useAuth();
  const canSms = hasFeature('messages-sms');
  const canEmail = hasFeature('messages-email');
  const defaultChannel = canEmail ? 'email' : 'sms';

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [showSendModal, setShowSendModal] = useState(false);
  const [newMessage, setNewMessage] = useState({
    senderName: '',
    senderRole: 'Admin',
    sendMode: 'Group',
    recipients: 'Parents',
    individualRole: 'Parent',
    recipientEmail: '',
    recipientPhone: '',
    message: '',
    attachment: null,
    deliveryChannel: defaultChannel,
  });
  const [sendingMessage, setSendingMessage] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [smsQuote, setSmsQuote] = useState(null);
  const [smsBalance, setSmsBalance] = useState(null);
  const [buyUnits, setBuyUnits] = useState('100');
  const [buyingUnits, setBuyingUnits] = useState(false);
  const [sendError, setSendError] = useState('');
  const location = useLocation();

  const loadSmsBalance = async () => {
    if (!canSms) return;
    try {
      const { data } = await axios.get('/api/sms/balance');
      setSmsBalance(data);
    } catch (err) {
      console.error('SMS balance error:', err);
    }
  };

  useEffect(() => {
    if (location.hash === '#list') {
      document.getElementById('list-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [location]);

  useEffect(() => {
    fetchMessages();
    loadSmsBalance();
  }, []);

  const fetchMessages = async () => {
    const cached = peekCache('messages');
    if (cached) {
      setMessages(cached);
      setLoading(false);
    }
    try {
      const data = await staleGet(
        'messages',
        async () => (await axios.get('/api/messages')).data,
        45000
      );
      setMessages(data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetCompose = () => {
    setNewMessage({
      senderName: '',
      senderRole: 'Admin',
      sendMode: 'Group',
      recipients: 'Parents',
      individualRole: 'Parent',
      recipientEmail: '',
      recipientPhone: '',
      message: '',
      attachment: null,
      deliveryChannel: defaultChannel,
    });
    setSmsQuote(null);
    setSendError('');
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    setSendError('');
    setSendingMessage(true);
    try {
      if (!newMessage.senderName.trim()) {
        setSendError('Please enter your name');
        setSendingMessage(false);
        return;
      }
      if (!newMessage.message.trim()) {
        setSendError('Please enter a message');
        setSendingMessage(false);
        return;
      }
      if (newMessage.deliveryChannel === 'email' && newMessage.sendMode === 'Individual' && !newMessage.recipientEmail.trim()) {
        setSendError('Please enter recipient email for individual message');
        setSendingMessage(false);
        return;
      }
      if (newMessage.deliveryChannel === 'sms' && newMessage.sendMode === 'Individual' && !newMessage.recipientPhone.trim()) {
        setSendError('Please enter recipient phone number for individual SMS');
        setSendingMessage(false);
        return;
      }

      if (newMessage.deliveryChannel === 'sms' && !smsQuote) {
        setQuoting(true);
        try {
          const { data } = await axios.post('/api/sms/quote', {
            message: newMessage.message,
            sendMode: newMessage.sendMode,
            recipients: newMessage.recipients,
            recipientPhone: newMessage.recipientPhone,
          });
          setSmsQuote(data);
          if (!data.can_send && data.blockers?.length) {
            setSendError(data.blockers.join(' '));
          }
        } catch (err) {
          setSendError(err.response?.data?.error || 'Failed to calculate SMS cost');
        } finally {
          setQuoting(false);
          setSendingMessage(false);
        }
        return;
      }

      if (newMessage.deliveryChannel === 'sms' && smsQuote && !smsQuote.can_send) {
        setSendError(
          smsQuote.blockers?.join(' ') ||
            'Not enough SMS units. Buy units from your wallet balance first.'
        );
        setSendingMessage(false);
        return;
      }

      const payload = {
        senderName: newMessage.senderName,
        senderRole: newMessage.senderRole,
        sendMode: newMessage.sendMode,
        recipients: newMessage.recipients,
        individualRole: newMessage.individualRole,
        recipientEmail: newMessage.recipientEmail,
        recipientPhone: newMessage.recipientPhone,
        attachmentName: newMessage.attachment?.name || null,
        message: newMessage.message,
        deliveryChannel: newMessage.deliveryChannel,
        confirmSmsPayment: newMessage.deliveryChannel === 'sms',
      };

      const { data } = await axios.post('/api/messages', payload);

      setShowSendModal(false);
      resetCompose();
      invalidateCache('messages');
      fetchMessages();
      loadSmsBalance();
      if (newMessage.deliveryChannel === 'sms') {
        const sent = data?.sms_delivery?.sent;
        const failed = data?.sms_delivery?.failed;
        const dry = data?.sms_delivery?.dryRun;
        if (dry) {
          toast.success(`TEST ONLY — no SMS sent. ${sent || 0} message(s) logged. Live send is off.`);
        } else if (failed > 0) {
          toast.success(`SMS sent to ${sent} recipient(s); ${failed} failed (units refunded for failures)`);
        } else {
          toast.success(`SMS sent to ${sent ?? 'all'} recipient(s)`);
        }
      } else {
        toast.success('Email broadcast sent');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setSendError(error.response?.data?.error || 'Failed to send message. Please try again.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleBuySmsUnits = async (e) => {
    e.preventDefault();
    setSendError('');
    setBuyingUnits(true);
    try {
      const units = Math.round(Number(buyUnits) || 0);
      if (units < 1) {
        setSendError('Enter at least 1 SMS unit to buy');
        return;
      }
      const { data } = await axios.post('/api/sms/purchase', { units });
      await loadSmsBalance();
      setSmsQuote(null);
      setSendError('');
      toast.success(
        `Bought ${data.units_purchased} SMS units for ${formatGhs(data.amount_major)}. Balance: ${data.sms_units}`
      );
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to buy SMS units');
      setSendError(err.response?.data?.error || 'Failed to buy SMS units');
    } finally {
      setBuyingUnits(false);
    }
  };

  const handleReply = async (messageId) => {
    try {
      await axios.post(`/api/messages/${messageId}/reply`, { reply: replyText });
      setReplyingTo(null);
      setReplyText('');
      invalidateCache('messages');
      fetchMessages();
    } catch (error) {
      console.error('Error sending reply:', error);
    }
  };

  const unitPrice = smsBalance?.unit_price_major || 0.05;
  const buyCost = (Number(buyUnits) || 0) * unitPrice;
  const smsCount = messages.filter((m) => (m.delivery_channel || 'email') === 'sms').length;
  const emailCount = messages.filter((m) => (m.delivery_channel || 'email') === 'email').length;

  if (!hasMessaging) {
    return <Navigate to="/dashboard" replace />;
  }

  if (loading && messages.length === 0) {
    return (
      <>
<div className="flex items-center justify-center py-24 text-slate-300">Loading messages…</div>
</>
    );
  }

  return (
    <>
<div className="relative space-y-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-6 -z-10 h-72"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 0% 0%, rgba(52, 152, 219, 0.16), transparent 55%), radial-gradient(ellipse 45% 40% at 100% 10%, rgba(39, 174, 96, 0.12), transparent 50%)',
          }}
        />

        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-300/90">
              Communication
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
              Bulk Messaging
            </h1>
          </div>
          <button
            type="button"
            onClick={() => {
              resetCompose();
              setShowSendModal(true);
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition hover:bg-primary-500"
          >
            {canEmail && !canSms ? <Mail className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
            New broadcast
          </button>
        </header>

        <section className="grid grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-4">
          <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-3 xl:p-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 xl:text-xs">Broadcasts</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-white xl:mt-3 xl:text-3xl">{messages.length}</p>
            <p className="mt-1 text-xs text-slate-500">
              {canSms && canEmail
                ? `${smsCount} SMS · ${emailCount} email`
                : canSms
                  ? 'SMS sends'
                  : 'Email sends'}
            </p>
          </div>

          {canSms && (
            <>
              <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-3 xl:p-5">
                <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 xl:text-xs">
                  <Coins className="h-3.5 w-3.5" />
                  SMS units
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-300 xl:mt-3 xl:text-3xl">
                  {smsBalance?.sms_units ?? '…'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-3 xl:p-5">
                <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 xl:text-xs">
                  <Wallet className="h-3.5 w-3.5" />
                  Wallet
                </p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-white xl:mt-3 xl:text-3xl">
                  {formatGhs(smsBalance?.wallet?.available_balance_major)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  <Link to="/school-wallet" className="text-primary-400 hover:text-primary-300">
                    Top up wallet
                  </Link>
                </p>
              </div>
              <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-3 xl:p-5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 xl:text-xs">Unit price</p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-white xl:mt-3 xl:text-3xl">{formatGhs(unitPrice)}</p>
              </div>
            </>
          )}

          {!canSms && (
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-3 xl:col-span-3 xl:p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Channel</p>
              <p className="mt-3 flex items-center gap-2 text-lg font-semibold text-white">
                <Mail className="h-5 w-5 text-primary-400" />
                Email broadcasts enabled
              </p>
              <p className="mt-1 text-xs text-slate-500">SMS is available on Professional and Enterprise plans.</p>
            </div>
          )}
        </section>

        {canSms && (
          <section className="rounded-3xl border border-slate-700/80 bg-slate-900/50 p-6 md:p-8">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Buy SMS units
                </h2>
              </div>
            </div>

            <form onSubmit={handleBuySmsUnits} className="mt-4 space-y-3 md:mt-6">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    Units
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={buyUnits}
                    onChange={(e) => setBuyUnits(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <Link
                  to="/school-wallet"
                  className="inline-flex h-[42px] shrink-0 items-center rounded-xl border border-slate-600 px-3 text-sm text-slate-200 transition hover:bg-slate-800 md:px-5"
                >
                  Open wallet
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-300">
                  Cost ≈ <span className="font-semibold text-white">{formatGhs(buyCost)}</span>
                </p>
                <button
                  type="submit"
                  disabled={buyingUnits}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60 md:px-5 md:py-3"
                >
                  {buyingUnits ? 'Converting…' : 'Buy units'}
                </button>
              </div>
            </form>
            {sendError && !showSendModal && (
              <p className="mt-4 text-sm text-red-300">{sendError}</p>
            )}
          </section>
        )}

        <section id="list-section" className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Recent broadcasts
              </h2>
            </div>
          </div>

          {messages.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-600 bg-slate-900/40 px-6 py-16 text-center">
              <MessageSquare className="mx-auto h-10 w-10 text-slate-600" />
              <p className="mt-4 text-slate-300">No broadcasts yet</p>
              <button
                type="button"
                onClick={() => {
                  resetCompose();
                  setShowSendModal(true);
                }}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-500"
              >
                <Send className="h-4 w-4" />
                New broadcast
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const channel = (message.delivery_channel || 'email') === 'sms' ? 'sms' : 'email';
                return (
                  <article
                    key={message.id}
                    className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-5 md:p-6"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                              channel === 'sms'
                                ? 'bg-emerald-500/15 text-emerald-200'
                                : 'bg-sky-500/15 text-sky-200'
                            }`}
                          >
                            {channel === 'sms' ? (
                              <MessageSquare className="h-3 w-3" />
                            ) : (
                              <Mail className="h-3 w-3" />
                            )}
                            {channel === 'sms' ? 'SMS' : 'Email'}
                          </span>
                          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                            {message.recipients || 'Parents'}
                          </span>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-white">{message.sender_name}</h3>
                      </div>
                      <p className="flex items-center gap-1.5 text-sm text-slate-400">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDistanceToNow(new Date(message.created_at))} ago
                      </p>
                    </div>

                    <p className="mt-4 whitespace-pre-wrap text-slate-200 leading-relaxed">{message.message}</p>

                    {message.reply ? (
                      <div className="mt-4 rounded-xl border border-primary-500/20 bg-primary-500/10 px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-primary-300">Admin reply</p>
                        <p className="mt-1.5 text-slate-100">{message.reply}</p>
                      </div>
                    ) : replyingTo === message.id ? (
                      <div className="mt-4 space-y-3">
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Type your reply…"
                          className={fieldClass}
                          rows={3}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleReply(message.id)}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500"
                          >
                            <Send className="h-4 w-4" />
                            Send reply
                          </button>
                          <button
                            type="button"
                            onClick={() => setReplyingTo(null)}
                            className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReplyingTo(message.id)}
                        className="mt-4 inline-flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300"
                      >
                        <Reply className="h-4 w-4" />
                        Reply
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {showSendModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl md:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">New broadcast</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Send to a group or a single recipient. Optional file for email.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSendModal(false);
                    resetCompose();
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSendMessage} className="mt-8 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Your name *
                    </label>
                    <input
                      type="text"
                      value={newMessage.senderName}
                      onChange={(e) => setNewMessage({ ...newMessage, senderName: e.target.value })}
                      placeholder="Admin name"
                      className={fieldClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Role
                    </label>
                    <input type="text" value="Admin" disabled className={`${fieldClass} opacity-70`} />
                  </div>
                </div>

                {canSms && canEmail && (
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Channel
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'sms', label: 'SMS', icon: MessageSquare },
                        { value: 'email', label: 'Email', icon: Mail },
                      ].map(({ value, label, icon: Icon }) => {
                        const selected = newMessage.deliveryChannel === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setSmsQuote(null);
                              setNewMessage({ ...newMessage, deliveryChannel: value });
                            }}
                            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                              selected
                                ? 'border-primary-500/60 bg-primary-500/15 text-white'
                                : 'border-slate-600 bg-slate-950/40 text-slate-200 hover:border-slate-500'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    Send to
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Group', 'Individual'].map((mode) => {
                      const selected = newMessage.sendMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setSmsQuote(null);
                            setNewMessage({ ...newMessage, sendMode: mode });
                          }}
                          className={`rounded-xl border px-4 py-3 text-sm transition ${
                            selected
                              ? 'border-primary-500/60 bg-primary-500/15 text-white'
                              : 'border-slate-600 bg-slate-950/40 text-slate-200 hover:border-slate-500'
                          }`}
                        >
                          {mode}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {newMessage.sendMode === 'Group' ? (
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Recipient group
                    </label>
                    <select
                      value={newMessage.recipients}
                      onChange={(e) => {
                        setSmsQuote(null);
                        setNewMessage({ ...newMessage, recipients: e.target.value });
                      }}
                      className={fieldClass}
                    >
                      <option value="Parents">Parents</option>
                      <option value="Teachers">Teachers</option>
                      <option value="Staff">Staff</option>
                      <option value="All Parents & Teachers">All Parents & Teachers</option>
                      <option value="All">All</option>
                    </select>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                        Recipient role
                      </label>
                      <select
                        value={newMessage.individualRole}
                        onChange={(e) => setNewMessage({ ...newMessage, individualRole: e.target.value })}
                        className={fieldClass}
                      >
                        <option value="Parent">Parent</option>
                        <option value="Teacher">Teacher</option>
                        <option value="Staff">Staff</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                        {newMessage.deliveryChannel === 'sms' ? 'Phone' : 'Email'}
                      </label>
                      <input
                        type="text"
                        value={
                          newMessage.deliveryChannel === 'sms'
                            ? newMessage.recipientPhone
                            : newMessage.recipientEmail
                        }
                        onChange={(e) =>
                          setNewMessage({
                            ...newMessage,
                            ...(newMessage.deliveryChannel === 'sms'
                              ? { recipientPhone: e.target.value }
                              : { recipientEmail: e.target.value }),
                          })
                        }
                        placeholder={
                          newMessage.deliveryChannel === 'sms' ? '0551234567' : 'someone@example.com'
                        }
                        className={fieldClass}
                        required={newMessage.sendMode === 'Individual'}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    Message *
                  </label>
                  <textarea
                    value={newMessage.message}
                    onChange={(e) => {
                      setSmsQuote(null);
                      setNewMessage({ ...newMessage, message: e.target.value });
                    }}
                    rows={5}
                    placeholder="Write your broadcast…"
                    className={`${fieldClass} resize-y`}
                    required
                  />
                </div>

                {newMessage.deliveryChannel === 'sms' && smsQuote && (
                  <div
                    className={`rounded-xl border p-4 text-sm ${
                      smsQuote.can_send
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-50'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-50'
                    }`}
                  >
                    <p className="font-semibold text-white">SMS units required</p>
                    <ul className="mt-2 space-y-1 text-slate-200">
                      <li>Recipients: {smsQuote.quote.recipients_count}</li>
                      <li>Segments / message: {smsQuote.quote.segments}</li>
                      <li className="font-semibold text-white">
                        Units to deduct: {smsQuote.quote.units_required}
                      </li>
                      <li>Your SMS units: {smsQuote.school_sms_units}</li>
                      <li>Platform units: {smsQuote.platform.units_available}</li>
                    </ul>
                    {!smsQuote.can_send && (
                      <p className="mt-3">{smsQuote.blockers?.join(' ')}</p>
                    )}
                    {smsQuote.can_send && (
                      <p className="mt-3 text-emerald-100">
                        Confirm to deduct {smsQuote.quote.units_required} units from your balance.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    Attachment
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-950/40 px-4 py-3 text-sm text-slate-200 hover:border-slate-500">
                      <Paperclip className="h-4 w-4" />
                      Choose file
                      <input
                        type="file"
                        accept="*/*"
                        onChange={(e) =>
                          setNewMessage({ ...newMessage, attachment: e.target.files?.[0] || null })
                        }
                        className="sr-only"
                      />
                    </label>
                    <span className="text-sm text-slate-400">
                      {newMessage.attachment ? newMessage.attachment.name : 'Optional'}
                    </span>
                  </div>
                </div>

                {sendError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-950/50 px-4 py-3 text-sm text-red-100">
                    {sendError}
                  </div>
                )}

                <div className="flex flex-nowrap items-center gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={sendingMessage || quoting}
                    className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50 md:flex-none md:gap-2 md:px-5 md:py-3 md:text-sm"
                  >
                    <Send className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {quoting
                        ? 'Calculating…'
                        : sendingMessage
                          ? 'Sending…'
                          : newMessage.deliveryChannel === 'sms' && !smsQuote
                            ? 'Check SMS units'
                            : newMessage.deliveryChannel === 'sms'
                              ? 'Confirm & send SMS'
                              : 'Send broadcast'}
                    </span>
                  </button>
                  {smsQuote && (
                    <button
                      type="button"
                      onClick={() => {
                        setSmsQuote(null);
                        setSendError('');
                      }}
                      className="shrink-0 rounded-xl border border-slate-600 px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-800 md:px-5 md:py-3 md:text-sm"
                    >
                      Recalculate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowSendModal(false);
                      resetCompose();
                    }}
                    className="shrink-0 rounded-xl border border-slate-600 px-3 py-2.5 text-xs text-slate-200 hover:bg-slate-800 md:px-5 md:py-3 md:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
</>
  );
};

export default Messages;
