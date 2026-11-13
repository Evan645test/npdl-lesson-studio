import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])';

export function FocusDialog({ label, onDismiss, children }: { label: string; onDismiss: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-start]')?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  function cycleTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const candidates = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0);
    const first = candidates[0], last = candidates.at(-1);
    const active = document.activeElement;
    const outsideSequence = !(active instanceof HTMLElement) || !candidates.includes(active);
    if (first && last && ((!event.shiftKey && active === last) || (event.shiftKey && (active === first || outsideSequence)))) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  return <dialog ref={ref} className="sp-dialog sp-native-dialog" aria-modal="true" aria-label={label} onKeyDown={cycleTab} onCancel={event => { event.preventDefault(); onDismiss(); }}>{children}</dialog>;
}
