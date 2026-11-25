import { useEffect, useRef, type ReactNode } from 'react';

/** Side panel over the page: traps focus, closes with Escape or the backdrop, and returns focus on close. */
export function SlideOver(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  return (
    <div className="overlay" onKeyDown={onKeyDown}>
      <div className="overlay-backdrop" onClick={() => close.current()} aria-hidden="true" />
      <div className={`slide-over ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="slide-title" ref={panel}>
        <header className="slide-head">
          <h2 id="slide-title">{props.title}</h2>
          <button className="icon-btn close" onClick={() => close.current()} aria-label={`Cerrar ${props.title}`} data-tip="Cerrar">
            ×
          </button>
        </header>
        <div className="slide-body">{props.children}</div>
      </div>
    </div>
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
