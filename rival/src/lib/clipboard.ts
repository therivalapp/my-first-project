import { Platform } from 'react-native';

// Copies text so it can be pasted into another app — used for session
// locations, which are typed free text rather than a map pin. People copy the
// location into whatever maps app they use, so RIVAL never has to guess the
// place from a typed name. (Exact pins wait for Apple MapKit, which needs the
// Apple Developer account.)
//
// Resolves true when the text reached the clipboard.
export async function copyText(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value || Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Older Safari, or a browser that blocks the async clipboard: fall back to
    // the legacy copy command on a throwaway, off-screen textarea.
    try {
      const el = document.createElement('textarea');
      el.value = value;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}
