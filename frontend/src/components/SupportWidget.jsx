import { useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Headphones, Mail, Phone, X } from 'lucide-react';
import { SUPPORT_PHONE, telHref } from '../constants/support';

const emptyForm = {
  fullName: '',
  email: '',
  contact: '',
  country: '',
  location: '',
  message: '',
};

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('choose');
  const [form, setForm] = useState(emptyForm);
  const [sending, setSending] = useState(false);
  const [phone, setPhone] = useState(SUPPORT_PHONE);

  useEffect(() => {
    let cancelled = false;
    axios
      .get('/api/public/support')
      .then(({ data }) => {
        if (!cancelled && data?.phone) setPhone(data.phone);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setMode('choose');
  };

  const onChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const submitEmail = async (event) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await axios.post('/api/public/support', form);
      toast.success('Your request was sent. We will reply by email.');
      setForm(emptyForm);
      close();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not send that request.');
    } finally {
      setSending(false);
    }
  };

  const callHref = telHref(phone);

  return (
    <>
      <button
        type="button"
        className="mk-support-fab"
        aria-label="Open support"
        onClick={() => {
          setOpen(true);
          setMode('choose');
        }}
      >
        <Headphones className="h-6 w-6" strokeWidth={2} />
      </button>

      {open ? (
        <div className="mk-support-overlay">
          <button type="button" className="mk-support-backdrop" aria-label="Close support" onClick={close} />
          <div className="mk-support-sheet" role="dialog" aria-labelledby="support-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="mk-kicker">Support</p>
                <h2 id="support-title" className="mt-1 font-serif text-2xl font-bold text-[var(--mk-ink)]">
                  {mode === 'email' ? 'Email Schooltype' : mode === 'call' ? 'Call Schooltype' : 'How can we help?'}
                </h2>
              </div>
              <button type="button" className="mk-support-close" aria-label="Close" onClick={close}>
                <X className="h-5 w-5" />
              </button>
            </div>

            {mode === 'choose' ? (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button type="button" className="mk-support-choice" onClick={() => setMode('email')}>
                  <Mail className="h-5 w-5" />
                  Email
                  <span>Send a public request to the Schooltype team</span>
                </button>
                <button type="button" className="mk-support-choice" onClick={() => setMode('call')}>
                  <Phone className="h-5 w-5" />
                  Call
                  <span>Speak with support on the phone</span>
                </button>
              </div>
            ) : null}

            {mode === 'email' ? (
              <form onSubmit={submitEmail} className="mt-5 space-y-3">
                <label className="block text-sm font-semibold">
                  Full name
                  <input name="fullName" value={form.fullName} onChange={onChange} required className="mk-field mt-1" />
                </label>
                <label className="block text-sm font-semibold">
                  Email
                  <input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={onChange}
                    required
                    className="mk-field mt-1"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Contact
                  <input
                    name="contact"
                    value={form.contact}
                    onChange={onChange}
                    required
                    placeholder="Phone or WhatsApp"
                    className="mk-field mt-1"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Country
                    <input name="country" value={form.country} onChange={onChange} required className="mk-field mt-1" />
                  </label>
                  <label className="block text-sm font-semibold">
                    Location
                    <input
                      name="location"
                      value={form.location}
                      onChange={onChange}
                      required
                      placeholder="City or town"
                      className="mk-field mt-1"
                    />
                  </label>
                </div>
                <label className="block text-sm font-semibold">
                  Message
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={onChange}
                    required
                    rows={4}
                    className="mk-field mt-1"
                  />
                </label>
                <p className="text-xs text-[var(--mk-muted)]">
                  This is a public request. It goes to the Schooltype super admin inbox, not into a school workspace.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={sending} className="mk-btn mk-btn-primary">
                    {sending ? 'Sending…' : 'Send request'}
                  </button>
                  <button type="button" className="mk-btn mk-btn-outline" onClick={() => setMode('choose')}>
                    Back
                  </button>
                </div>
              </form>
            ) : null}

            {mode === 'call' ? (
              <div className="mt-5 space-y-4">
                {callHref ? (
                  <>
                    <p className="mk-lead text-sm">Call the Schooltype support line.</p>
                    <p className="font-serif text-xl font-bold">{phone}</p>
                    <a href={callHref} className="mk-btn mk-btn-primary">
                      Call now
                    </a>
                  </>
                ) : (
                  <p className="mk-lead text-sm">
                    A phone line is not published yet. Send an email request and we will call you back on the contact
                    you provide.
                  </p>
                )}
                <button type="button" className="mk-btn mk-btn-outline" onClick={() => setMode('choose')}>
                  Back
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
