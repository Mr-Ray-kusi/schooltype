import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SUPPORT_FAQS } from '../constants/support';

export default function FaqSection() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="scroll-mt-24 border-t border-[var(--mk-line)] bg-[var(--mk-paper)] px-5 py-20 sm:px-7 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-[800px]">
        <p className="mk-kicker">Questions</p>
        <h2 className="mt-3 font-serif text-3xl font-bold tracking-tight text-[var(--mk-ink)] sm:text-4xl">
          Frequent questions
        </h2>
        <p className="mk-lead mt-4 text-base">
          For anything else, use the support button.
        </p>
        <div className="mt-8 divide-y divide-[var(--mk-line)] border-y border-[var(--mk-line)]">
          {SUPPORT_FAQS.map((item, index) => {
            const expanded = open === index;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 py-4 text-left"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? -1 : index)}
                >
                  <span className="font-serif text-lg font-bold text-[var(--mk-ink)]">{item.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-[var(--mk-forest)] transition ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {expanded ? <p className="mk-lead pb-4 text-sm">{item.a}</p> : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
