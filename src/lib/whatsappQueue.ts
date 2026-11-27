import { whatsappLink, type AlertSendMode } from '@/lib/whatsapp';

export type OpenResult = { ok: boolean; link: string };
// Opens a WhatsApp chat with the message pre-filled. For the 'app' mode the
// whatsapp:// protocol link is fired from a throwaway anchor — this never opens a
// browser tab, so no "Scan to log in" QR page can appear. If the app is not installed
// the anchor click simply does nothing visible, and ok is returned as false so the
// caller can show the whatsapp:// link as a clickable button.
//
// 'web' and 'wa.me' modes use window.open, which can open a browser tab — these are
// only used when the user explicitly picks them from the toggle.
export function openWhatsAppChat(
  phone: string | null,
  message: string,
  mode: AlertSendMode,
): OpenResult {
  const link = whatsappLink(phone, message, mode);

  if (mode === 'app') {
    // Fire the whatsapp:// protocol link from a hidden anchor. This hands off to the
    // installed WhatsApp app without opening any browser tab. If WhatsApp is not
    // installed, nothing visible happens — the caller shows the link as a button.
    const anchor = document.createElement('a');
    anchor.href = link;
    anchor.rel = 'noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // We cannot reliably detect whether the protocol handler launched the app, so
    // return false to let the caller show a clickable fallback link regardless.
    return { ok: false, link };
  }

  const opened = window.open(link, '_blank', 'noopener,noreferrer');
  return { ok: Boolean(opened), link };
}
