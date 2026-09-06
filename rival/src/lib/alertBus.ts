// Tiny pub/sub so notify.ts (a plain module-level function, called from
// anywhere with no React context available) can hand off to a styled
// in-app modal — RivalAlertHost, mounted once in _layout.tsx — instead of
// window.alert. Falls back to window.alert only if the host somehow isn't
// mounted yet (shouldn't happen in practice, but a message should never be
// silently dropped).
export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Paints the confirm button as a warning rather than the usual accent —
  // for the deletes, where the safe choice should be the visually louder one.
  destructive?: boolean;
};

type Listener = (title: string, message?: string) => void;
type ConfirmListener = (opts: ConfirmOptions, resolve: (ok: boolean) => void) => void;

let listener: Listener | null = null;
let confirmListener: ConfirmListener | null = null;

export function setAlertListener(l: Listener | null) {
  listener = l;
}

export function setConfirmListener(l: ConfirmListener | null) {
  confirmListener = l;
}

export function emitAlert(title: string, message?: string) {
  if (listener) {
    listener(title, message);
  } else if (typeof window !== 'undefined') {
    window.alert(message ? `${title}\n\n${message}` : title);
  }
}

export function emitConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (confirmListener) {
    return new Promise<boolean>((resolve) => confirmListener!(opts, resolve));
  }
  // Same last-resort fallback as emitAlert — a confirm that silently
  // resolved false would look like a dead button.
  if (typeof window !== 'undefined') {
    return Promise.resolve(window.confirm(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title));
  }
  return Promise.resolve(false);
}
