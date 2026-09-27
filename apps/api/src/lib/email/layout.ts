/**
 * The shared shell every email is rendered into.
 *
 * Deliberately dependency-free and pure — no db, no transport, no env — which
 * is what lets templates.test.ts run the real renderer with nothing set up.
 *
 * Email clients are a decade behind browsers: tables for layout, inline styles
 * only (Gmail strips <style> blocks), no flexbox, no CSS variables, and Outlook
 * ignores border-radius outright — rounded things simply render square there,
 * which is a fine floor to land on.
 */

/** The product name in the chrome. The inviting COMPANY is passed in per email. */
export const BRAND = 'Cino';

export type Locale = 'en' | 'no';

export const DEFAULT_LOCALE: Locale = 'en';

/** Narrows anything stored about a user to a locale we actually render. */
export function toLocale(value: string | null | undefined): Locale {
  return value === 'no' ? 'no' : DEFAULT_LOCALE;
}

/**
 * Escapes interpolated text.
 *
 * Every template writes names people chose — a production called
 * `<img src=x onerror=...>` is a legitimate name and must arrive as text, not
 * as markup, in whichever webmail opens it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Palette ───────────────────────────────────────────────────────────────────
// Light on purpose. The app is dark, but a dark email is the one thing clients
// disagree about most: Gmail's apps re-invert dark markup and Outlook does not,
// so the same message arrives legible for some people and muddy for others.

const PAGE   = '#f4f5f7';
const CARD   = '#ffffff';
const BORDER = '#e7e9ee';
const TEXT   = '#14161a';
const BODY   = '#4a5160';
const MUTED  = '#8b93a1';
const ACCENT = '#2f6bff';

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// ── Monogram colour ───────────────────────────────────────────────────────────

/** Stable hue from a name, so a company keeps the same colour in every email. */
export function hueFromName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

/** hsl → hex, because Outlook and several webmail clients drop hsl(). */
export function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** First letters of the first two words — "Dancing with the stars" → "DW". */
export function monogram(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('');
  return (letters || name.slice(0, 1) || '?').toUpperCase();
}

// ── Layout ────────────────────────────────────────────────────────────────────

export interface MediaBlock {
  /**
   * Content-ID of an inline attachment, when one could be loaded.
   *
   * Inline rather than a URL because storage is behind auth and an email client
   * sends no cookies — a `/api/storage/.../serve` link would arrive broken,
   * and Gmail would fetch it through its own proxy besides.
   */
  cid?:  string | null;
  /** Always present: the fallback when there is no image, and the alt text source. */
  name:  string;
}

export interface LayoutOptions {
  /** The grey line the inbox shows next to the subject. */
  preheader: string;
  media?:    MediaBlock;
  /** Pre-escaped. The large line: "Lars from Cino invited you to …". */
  heading:   string;
  /** Pre-escaped paragraphs. */
  body:      string;
  button?:   { label: string; url: string };
  /** Pre-escaped small print. */
  footer:    string;
}

function renderMedia(media: MediaBlock): string {
  const SIZE = 64;

  const inner = media.cid
    ? `<img src="cid:${escapeHtml(media.cid)}" width="${SIZE}" height="${SIZE}" alt="${escapeHtml(media.name)}"
           style="border-radius:16px;display:block;height:${SIZE}px;object-fit:cover;width:${SIZE}px;">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
         <tr><td align="center" valign="middle" bgcolor="${hslToHex(hueFromName(media.name), 62, 52)}"
             style="border-radius:16px;color:#ffffff;font-family:${FONT};font-size:24px;font-weight:700;height:${SIZE}px;letter-spacing:0.5px;width:${SIZE}px;">
           ${escapeHtml(monogram(media.name))}
         </td></tr>
       </table>`;

  return `<tr><td style="padding:0 0 24px;">${inner}</td></tr>`;
}

export function renderLayout({ preheader, media, heading, body, button, footer }: LayoutOptions): string {
  const buttonHtml = button
    ? `<tr><td style="padding:28px 0 4px;">
         <a href="${escapeHtml(button.url)}"
            style="background:${ACCENT};border-radius:10px;color:#ffffff;display:inline-block;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;padding:14px 26px;text-decoration:none;">${escapeHtml(button.label)}</a>
       </td></tr>`
    : '';

  // Trailing whitespace characters stop the body text from being pulled into
  // the inbox preview after the preheader.
  const preheaderHtml = `<div style="display:none;max-height:0;mso-hide:all;opacity:0;overflow:hidden;">${escapeHtml(preheader)}${'&#8199;&#65279;'.repeat(60)}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Opt out of the clients that would auto-invert this light design into an unreadable one. -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="background:${PAGE};color-scheme:light;margin:0;padding:0;width:100%;">
${preheaderHtml}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};border-collapse:collapse;">
  <tr><td align="center" style="padding:32px 16px;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:${CARD};border:1px solid ${BORDER};border-collapse:separate;border-radius:16px;max-width:560px;">
      <tr><td style="padding:36px 36px 40px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr><td style="color:${MUTED};font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;padding:0 0 28px;text-transform:uppercase;">${escapeHtml(BRAND)}</td></tr>
          ${media ? renderMedia(media) : ''}
          <tr><td style="color:${TEXT};font-family:${FONT};font-size:24px;font-weight:700;letter-spacing:-0.3px;line-height:1.3;padding:0 0 12px;">${heading}</td></tr>
          <tr><td style="color:${BODY};font-family:${FONT};font-size:15px;line-height:1.65;">${body}</td></tr>
          ${buttonHtml}
        </table>

      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:560px;">
      <tr><td style="color:${MUTED};font-family:${FONT};font-size:12px;line-height:1.6;padding:20px 8px 0;">${footer}</td></tr>
    </table>

  </td></tr>
</table>
</body></html>`;
}

export interface RenderedMail {
  subject: string;
  html:    string;
  text:    string;
}
