import { Link, useLocation } from 'react-router-dom';
import MarketingChrome from '../components/MarketingChrome';

const PAGES = {
  '/terms': {
    title: 'Terms',
    sections: [
      {
        heading: 'Using Schooltype',
        body: 'Schooltype is a school operations service for school owners and administrators in Ghana. Creating an account, choosing a plan, and paying through Paystack means you agree to use the service for your school’s academic and fee operations.',
      },
      {
        heading: 'School accounts',
        body: 'The school administrator is responsible for people they add, records they enter, and how staff use the school workspace. Each school stays in its own data boundary.',
      },
      {
        heading: 'Plans and payment',
        body: 'Plans are priced yearly in Ghana cedis by student capacity. The school account is created only after payment succeeds. Paystack handles MoMo, card, and bank checkout. Schooltype does not ask for a MoMo PIN.',
      },
    ],
  },
  '/refunds': {
    title: 'Refunds',
    sections: [
      {
        heading: 'Plan payments',
        body: 'Yearly plan payments are collected by Paystack when you create a school account. If a charge fails or is duplicated, contact Schooltype from the email used on the account so the payment can be reviewed.',
      },
      {
        heading: 'Parent fee payments',
        body: 'Parents pay school fees to the school they select. Questions about a fee amount, a receipt, or a refund of school fees should go to that school. Schooltype processes the payment; the school is responsible for the fee.',
      },
    ],
  },
  '/cookies': {
    title: 'Cookies',
    sections: [
      {
        heading: 'What we store',
        body: 'After sign-in, a session token and school profile stay in local storage so the administrator stays signed in. If you choose remember email, only that email is saved on this device.',
      },
      {
        heading: 'How to clear them',
        body: 'Signing out or clearing site data removes the session and the remembered email. Schooltype does not use these stores as a marketing list.',
      },
    ],
  },
  '/image-licensing': {
    title: 'Image licensing',
    sections: [
      {
        heading: 'Marketing photographs',
        body: 'Photographs on the public Schooltype pages show Ghanaian school life: a courtyard, a classroom, an office, and a parent paying on a phone. They illustrate the product. They are not portraits of a specific Schooltype school’s students unless that school supplied them.',
      },
      {
        heading: 'School logos',
        body: 'A school may upload its own logo when creating an account. That mark belongs to the school. Schooltype stores it only to operate the school account.',
      },
    ],
  },
  '/sitemap': {
    title: 'Sitemap',
    sections: [],
  },
};

const SITE_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/#about', label: 'About' },
  { to: '/#features', label: 'Features' },
  { to: '/fees', label: 'Fees payment' },
  { to: '/#security', label: 'Security' },
  { to: '/plans', label: 'Get started' },
  { to: '/login', label: 'Sign in' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/refunds', label: 'Refunds' },
  { to: '/cookies', label: 'Cookies' },
  { to: '/image-licensing', label: 'Image licensing' },
];

const Legal = () => {
  const { pathname } = useLocation();
  const page = PAGES[pathname] || PAGES['/terms'];

  return (
    <MarketingChrome>
      <div className="mk-page">
        <article className="mx-auto max-w-3xl">
          <h1 className="font-serif text-4xl font-bold">{page.title}</h1>
          {pathname === '/sitemap' ? (
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {SITE_LINKS.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-8 space-y-8">
              {page.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="font-serif text-xl font-bold">{section.heading}</h2>
                  <p className="mk-lead mt-2 text-sm">{section.body}</p>
                </section>
              ))}
            </div>
          )}
          <p className="mt-12 text-sm">
            <Link to="/" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
              Back to home
            </Link>
          </p>
        </article>
      </div>
    </MarketingChrome>
  );
};

export default Legal;
