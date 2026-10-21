import { Link } from 'react-router-dom';

const Privacy = () => (
  <div className="min-h-screen bg-slate-950 px-6 py-16 text-slate-300 md:px-10">
    <div className="mx-auto max-w-3xl">
      <p className="font-display text-xl font-extrabold tracking-tight text-white">SCHOOLTYPE</p>
      <h1 className="mt-8 font-display text-4xl font-bold text-white">Privacy notice</h1>
      <p className="mt-3 text-sm text-slate-500">Last updated: 21 October 2026</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="font-display text-lg font-bold text-white">Why we collect your email</h2>
          <p className="mt-2">
            Schooltype collects a school administrator email only to create and operate your school
            account. That includes sign-in, email verification, password setup, plan and billing
            notices, and essential service messages. This is necessary to provide the service, not
            a marketing list. We do not sell contact details.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-white">School records</h2>
          <p className="mt-2">
            Student, staff, parent, attendance, fee, and message data is entered by the school.
            The school is responsible for that information. Schooltype stores and processes it so
            the school can run attendance, IDs, messaging, and related tools. A public ID page is
            for returning a found card: it shows name, school, class or role, student ID when
            stored, and the parent phone so the school can be reached. It does not show a portrait,
            email, home address, or date of birth. Parents cannot sign in to see results or
            attendance.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-white">What we store in your browser</h2>
          <p className="mt-2">
            After you sign in we keep a session token and school profile in local storage so you
            stay signed in. If you choose “remember email”, only that email is saved on this
            device. You can clear these by signing out or clearing site data.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-white">Processors</h2>
          <p className="mt-2">
            Depending on features you use, data may be processed by hosting and database providers
            (including Vercel and Supabase), email delivery, Google sign-in, Paystack for wallet
            payments, and SMS providers such as Twilio. Payment details are handled by Paystack;
            Schooltype does not store your MoMo PIN.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-white">Your rights</h2>
          <p className="mt-2">
            You may request access to, correction of, or deletion of your school administrator
            account data. Schools should handle requests about student and parent records they
            entered. To make a request, sign in and contact Schooltype from your school account,
            or use the email address on your account.
          </p>
        </section>
      </div>

      <p className="mt-12 text-sm">
        <Link to="/" className="text-sky-400 hover:text-sky-300">
          Back to home
        </Link>
        <span className="px-2 text-slate-600">·</span>
        <Link to="/signup" className="text-sky-400 hover:text-sky-300">
          Create an account
        </Link>
      </p>
    </div>
  </div>
);

export default Privacy;
