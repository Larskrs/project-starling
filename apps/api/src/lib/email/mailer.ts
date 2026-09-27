import { createTransport, type Transporter } from 'nodemailer';

/**
 * Outgoing mail, sent through the host's own SMTP server (Plesk/Postfix).
 *
 * Handing a message to a local MTA is the whole reason this needs no outbox
 * table: Postfix owns the queue, the retries and the backoff once the message
 * is accepted, and that takes milliseconds on the same machine. The app only
 * has to survive the submission — which is why the invite mails in email/notify.ts can be
 * fire-and-forget without losing mail to a Passenger restart.
 */

const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';

/** Implicit TLS (465). Port 587 upgrades via STARTTLS instead. */
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';

/**
 * Only for a local MTA reached as `localhost`, whose certificate is issued for
 * the mail hostname and so never matches. Off everywhere else — the point of
 * TLS to a remote relay is the name check.
 */
const SMTP_ALLOW_INSECURE_TLS = process.env.SMTP_ALLOW_INSECURE_TLS === 'true';

const MAIL_FROM = process.env.MAIL_FROM ?? 'Starling <no-reply@localhost>';

/** Public origin of the web app — every link in an email is built from it. */
export const APP_URL = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');

/** Absolute URL into the web app, e.g. `appUrl('/c/acme/p/show/dashboard')`. */
export function appUrl(path: string): string {
  return `${APP_URL}/${path.replace(/^\/+/, '')}`;
}

/**
 * An image embedded in the message body, referenced as `cid:<cid>`.
 *
 * Inline rather than a link because storage sits behind auth: an email client
 * sends no cookies, and Gmail fetches remote images through its own proxy, so
 * a `/api/storage/.../serve` URL would arrive as a broken image every time.
 */
export interface MailAttachment {
  filename:    string;
  content:     Buffer;
  cid:         string;
  contentType: string;
}

export interface OutgoingMail {
  to:           string;
  subject:      string;
  html:         string;
  text:         string;
  replyTo?:     string;
  attachments?: MailAttachment[];
}

/** `undefined` = not built yet, `null` = no SMTP configured (log instead). */
let transport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;

  if (!SMTP_HOST) {
    transport = null;
    return null;
  }

  transport = createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_SECURE,
    ...(SMTP_USER ? { auth: { user: SMTP_USER, pass: SMTP_PASS } } : {}),
    ...(SMTP_ALLOW_INSECURE_TLS ? { tls: { rejectUnauthorized: false } } : {}),
    // The invite burst of one person adding a crew is the load this sees; a
    // couple of reused connections is plenty, and it keeps the app well under
    // Plesk's outgoing-message limits.
    pool:           true,
    maxConnections: 2,
  });

  return transport;
}

/** Sends now, and throws if the server refuses the message. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const tx = getTransport();

  // No SMTP configured (dev, tests, a fresh checkout): print it instead of
  // failing, so nothing downstream has to care whether mail is set up.
  if (!tx) {
    console.log(`\x1b[2m[mail] (not sent — SMTP_HOST unset)\x1b[0m to=${mail.to} subject=${mail.subject}\n${mail.text}\n`);
    return;
  }

  await tx.sendMail({
    from:    MAIL_FROM,
    to:      mail.to,
    subject: mail.subject,
    text:    mail.text,
    html:    mail.html,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    ...(mail.attachments?.length
      ? { attachments: mail.attachments.map((a) => ({ ...a, contentDisposition: 'inline' as const })) }
      : {}),
  });
}

/**
 * Checks the SMTP credentials at startup and warns — never throws.
 *
 * A wrong password otherwise stays invisible until the first person wonders
 * aloud why their invite never arrived.
 */
export async function verifyMailer(): Promise<void> {
  const tx = getTransport();
  if (!tx) {
    console.log('\x1b[2m[mail] SMTP_HOST unset — emails will be logged, not sent\x1b[0m');
    return;
  }

  try {
    await tx.verify();
    console.log(`\x1b[2m[mail] SMTP ready at ${SMTP_HOST}:${SMTP_PORT}\x1b[0m`);
  } catch (err) {
    console.warn(`[mail] SMTP at ${SMTP_HOST}:${SMTP_PORT} is not usable:`, (err as Error).message);
  }
}
