import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Globe, Menu, X } from 'lucide-react';
import { SOCIAL_LINKS } from '../constants/socials';

export const MARKETING_NAV = [
  { id: 'home', label: 'Home', href: '/#home' },
  { id: 'about', label: 'About', href: '/#about' },
  { id: 'features', label: 'Features', href: '/#features' },
  { id: 'fees', label: 'Fees', href: '/fees' },
  { id: 'security', label: 'Security', href: '/#security' },
];

export const scrollToId = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const BrandMark = ({ onHome }) => (
  <Link
    to="/"
    className="mk-brand min-w-0"
    onClick={(event) => {
      if (onHome) {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        onHome();
      }
    }}
  >
    <span className="mk-brand-name">SCHOOLTYPE</span>
    <span className="mk-brand-tag">Connect. Track. Manage.</span>
  </Link>
);

export default function MarketingChrome({
  children,
  active = 'home',
  observeHome = false,
  overlayNav = false,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState(active);
  const onHome = location.pathname === '/';

  useEffect(() => {
    setActiveId(active);
  }, [active]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!onHome) return undefined;
    const hash = String(location.hash || window.location.hash || '').replace('#', '');
    if (hash) {
      window.setTimeout(() => scrollToId(hash), 40);
    }
    return undefined;
  }, [onHome, location.hash]);

  useEffect(() => {
    if (!observeHome || !onHome) return undefined;
    const sectionIds = MARKETING_NAV.filter((item) => item.href.includes('#')).map((item) => item.id);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActiveId(visible.target.id);
      },
      { rootMargin: '-18% 0px -58% 0px', threshold: [0.12, 0.32, 0.5] }
    );
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [observeHome, onHome]);

  const goNav = (item) => {
    setMenuOpen(false);
    setActiveId(item.id);
    if (item.href.startsWith('/#') || item.href.startsWith('#')) {
      const id = item.href.split('#')[1];
      if (onHome) {
        scrollToId(id);
        return;
      }
      navigate(`/#${id}`);
      return;
    }
    navigate(item.href);
  };

  return (
    <div className="mk">
      <header className={`mk-header ${overlayNav ? 'mk-header-overlay' : ''}`}>
        <div className="mk-header-bar">
          <BrandMark
            onHome={
              onHome
                ? () => {
                    setActiveId('home');
                    setMenuOpen(false);
                  }
                : null
            }
          />

          <nav className="mk-nav-desktop" aria-label="Marketing">
            {MARKETING_NAV.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={`mk-nav-link ${activeId === item.id ? 'is-active' : ''}`}
                onClick={(event) => {
                  event.preventDefault();
                  goNav(item);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="mk-header-actions">
            <Link to="/login" className="mk-btn mk-btn-ghost">
              Sign in
            </Link>
            <Link to="/plans" className="mk-btn mk-btn-primary">
              Get started
            </Link>
            <button
              type="button"
              className="mk-menu-toggle"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="mk-menu">
            {MARKETING_NAV.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={`mk-menu-link ${activeId === item.id ? 'is-active' : ''}`}
                onClick={(event) => {
                  event.preventDefault();
                  goNav(item);
                }}
              >
                {item.label}
              </a>
            ))}
            <div className="mk-menu-actions">
              <Link to="/login" className="mk-btn mk-btn-ghost" onClick={() => setMenuOpen(false)}>
                Sign in
              </Link>
              <Link to="/plans" className="mk-btn mk-btn-primary" onClick={() => setMenuOpen(false)}>
                Get started
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      <main>{children}</main>

      <footer className="mk-footer">
        <div className="mk-footer-shell">
          <div className="mk-footer-top">
            <div>
              <p className="mk-brand-name">SCHOOLTYPE</p>
              <p className="mk-brand-tag">Connect. Track. Manage.</p>
            </div>
            <nav className="mk-footer-links" aria-label="Footer">
              <Link to="/#about">About</Link>
              <Link to="/#features">Features</Link>
              <Link to="/fees">Fees payment</Link>
              <Link to="/#security">Security</Link>
              <Link to="/login">Sign in</Link>
              <Link to="/plans">Get started</Link>
            </nav>
          </div>

          <div className="mk-footer-meta">
            <p>© 2026 SCHOOLTYPE. All rights reserved.</p>
            <p className="mk-footer-locale">
              <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
              Ghana and English
            </p>
          </div>

          <div className="mk-footer-bottom">
            <nav className="mk-footer-links" aria-label="Legal">
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
              <Link to="/refunds">Refunds</Link>
              <Link to="/cookies">Cookies</Link>
              <Link to="/image-licensing">Image licensing</Link>
              <Link to="/sitemap">Sitemap</Link>
            </nav>
            <nav className="mk-footer-social" aria-label="Social">
              {SOCIAL_LINKS.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.label}
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                </a>
              ))}
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
