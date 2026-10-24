import { Link } from 'react-router-dom';
import MarketingChrome from '../components/MarketingChrome';

const SECTIONS = [
  {
    title: 'Why we collect your email',
    body: 'Schooltype collects a school administrator email only to create and operate the school account. That includes sign-in, email verification, password setup, plan and billing notices, and essential service messages. This is necessary to provide the service, not a marketing list. We do not sell contact details.',
  },
  {
    title: 'School records',
    body: 'Student, staff, parent, attendance, fee, and message data is entered by the school. The school is responsible for that information. A public ID page is for returning a found card: it shows name, school, class or role, student ID when stored, and the parent phone so the school can be reached. It does not show a portrait, email, home address, or date of birth. Parents cannot sign in to see results or attendance.',
  },
  {
    title: 'What we store in your browser',
    body: 'After sign-in, a session token and school profile stay in local storage. If you choose remember email, only that email is saved on this device. Signing out or clearing site data removes them.',
  },
  {
    title: 'Processors',
    body: 'Hosting and database providers including Vercel and Supabase, email delivery, Google sign-in, Paystack for payments, and SMS providers such as Twilio. Payment details are handled by Paystack. Schooltype does not store a MoMo PIN.',
  },
  {
    title: 'Your rights',
    body: 'Request access, correction, or deletion of the school administrator account. Schools handle requests about student and parent records they entered.',
  },
];

const Privacy = () => (
  <MarketingChrome>
    <div className="mk-page">
      <article className="mx-auto max-w-3xl">
        <h1 className="font-serif text-4xl font-bold text-[var(--mk-ink)]">Privacy notice</h1>
        <p className="mt-3 text-sm text-[var(--mk-muted)]">Last updated: 21 October 2026</p>
        <div className="mt-10 space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-serif text-xl font-bold">{section.title}</h2>
              <p className="mk-lead mt-2 text-sm">{section.body}</p>
            </section>
          ))}
        </div>
        <p className="mt-12 text-sm">
          <Link to="/" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
            Back to home
          </Link>
          <span className="px-2 text-[var(--mk-line)]">·</span>
          <Link to="/plans" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      </article>
    </div>
  </MarketingChrome>
);

export default Privacy;
