"use client";

import { useState } from "react";

/**
 * The FAQ accordion.
 *
 * The mockup used `onclick="toggle(this)"` on a <div>, which mouse users can operate and nobody
 * else can. Same visual behaviour here, but each question is a real <button> carrying
 * aria-expanded/aria-controls, so it's reachable by keyboard and announced correctly. The answer
 * stays in the DOM (collapsed with max-height) to preserve the mockup's slide transition; it's
 * hidden from assistive tech with `inert` while closed so a screen reader doesn't read out answers
 * to questions that appear shut.
 */
export interface FaqEntry {
  q: string;
  a: React.ReactNode;
}

export function FaqAccordion({ id, items }: { id: string; items: FaqEntry[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      {items.map((item, index) => {
        const open = openIndex === index;
        const answerId = `${id}-a-${index}`;
        return (
          <div className={`mk-faq-item${open ? " open" : ""}`} key={item.q}>
            <button type="button" className="mk-faq-q" aria-expanded={open} aria-controls={answerId} onClick={() => setOpenIndex(open ? null : index)}>
              {item.q}
              <span className="chev" aria-hidden="true">
                ▼
              </span>
            </button>
            <div className="mk-faq-a" id={answerId} inert={!open}>
              {item.a}
            </div>
          </div>
        );
      })}
    </>
  );
}
