import {
  escapeHtml, renderLayout, BRAND, DEFAULT_LOCALE, type Locale, type RenderedMail,
} from './layout.js';

/**
 * One function per email, each pure: values in, `{ subject, html, text }` out.
 *
 * Callers pass an absolute `url` (built with `appUrl`) and, when there is one,
 * the `imageCid` of an already-attached image — so nothing here touches the
 * environment, the database or the disk, and every template stays testable.
 *
 * A plain-text part is not optional: spam filters treat HTML-only mail as a
 * signal, and some clients still show text first.
 */

const STRINGS = {
  en: {
    openProduction: 'Open production',
    openCompany:    'Open company',
    someone:        'Someone',
    roleAdmin:      'an admin',
    roleMember:     'a member',

    productionSubject:   (inviter: string, production: string) => `${inviter} invited you to ${production}`,
    productionHeading:   (inviter: string, company: string, production: string) =>
      `${inviter} from ${company} invited you to ${production}`,
    productionPreheader: (production: string) => `You now have access to ${production} — timelines, files and everything the team shares.`,
    productionBody:      '<p style="margin:0;">You now have access to everything the team shares there — timelines, files, and changes as they happen.</p>',
    productionFooter:    (inviter: string, production: string) =>
      `${BRAND} · You received this because ${inviter} added you to ${production}.`,

    verifySubject:   'Confirm your email address',
    verifyHeading:   'Confirm your email address',
    verifyPreheader: (hours: string) => `Confirm your address — the link is good for ${hours}.`,
    verifyBody:      (hours: string) =>
      `<p style="margin:0 0 10px;">Confirm this address so we know we can reach you about the productions you work on.</p>` +
      `<p style="color:#8b93a1;font-size:13px;margin:0;">This link expires in ${hours}. If you did not ask for it, you can ignore this email.</p>`,
    verifyButton:    'Confirm email',
    verifyFooter:    `${BRAND} · You received this because someone asked to confirm this address.`,

    joinPreheader: (hours: string) => `Accept within ${hours} to create your account and join.`,
    joinBody:      (hours: string) =>
      `<p style="margin:0 0 10px;">Accept the invitation to create your account and join the production.</p>` +
      `<p style="color:#8b93a1;font-size:13px;margin:0;">This link works once and expires in ${hours}.</p>`,
    joinButton:    'Accept invitation',
    hours:         (n: number) => (n === 1 ? '1 hour' : `${n} hours`),

    companySubject:   (inviter: string, company: string) => `${inviter} invited you to ${company}`,
    companyHeading:   (inviter: string, company: string) => `${inviter} invited you to ${company}`,
    companyPreheader: (company: string) => `You're now part of ${company}.`,
    companyBody:      (role: string) =>
      `<p style="margin:0;">You joined as <strong style="color:#14161a;">${role}</strong>. You'll find the company's productions you're a member of inside.</p>`,
    companyFooter:    (inviter: string, company: string) =>
      `${BRAND} · You received this because ${inviter} added you to ${company}.`,
  },
  no: {
    openProduction: 'Åpne produksjonen',
    openCompany:    'Åpne selskapet',
    someone:        'Noen',
    roleAdmin:      'administrator',
    roleMember:     'medlem',

    productionSubject:   (inviter: string, production: string) => `${inviter} inviterte deg til ${production}`,
    productionHeading:   (inviter: string, company: string, production: string) =>
      `${inviter} fra ${company} inviterte deg til ${production}`,
    productionPreheader: (production: string) => `Du har nå tilgang til ${production} — tidslinjer, filer og alt teamet deler.`,
    productionBody:      '<p style="margin:0;">Du har nå tilgang til alt teamet deler der — tidslinjer, filer og endringer etter hvert som de skjer.</p>',
    productionFooter:    (inviter: string, production: string) =>
      `${BRAND} · Du fikk denne e-posten fordi ${inviter} la deg til i ${production}.`,

    verifySubject:   'Bekreft e-postadressen din',
    verifyHeading:   'Bekreft e-postadressen din',
    verifyPreheader: (hours: string) => `Bekreft adressen din — lenken varer i ${hours}.`,
    verifyBody:      (hours: string) =>
      `<p style="margin:0 0 10px;">Bekreft denne adressen, så vet vi at vi når deg om produksjonene du jobber på.</p>` +
      `<p style="color:#8b93a1;font-size:13px;margin:0;">Lenken utløper om ${hours}. Har du ikke bedt om den, kan du se bort fra denne e-posten.</p>`,
    verifyButton:    'Bekreft e-post',
    verifyFooter:    `${BRAND} · Du fikk denne e-posten fordi noen ba om å bekrefte denne adressen.`,

    joinPreheader: (hours: string) => `Ta imot invitasjonen innen ${hours} for å opprette konto og bli med.`,
    joinBody:      (hours: string) =>
      `<p style="margin:0 0 10px;">Ta imot invitasjonen for å opprette kontoen din og bli med i produksjonen.</p>` +
      `<p style="color:#8b93a1;font-size:13px;margin:0;">Lenken virker én gang og utløper om ${hours}.</p>`,
    joinButton:    'Ta imot invitasjonen',
    hours:         (n: number) => (n === 1 ? '1 time' : `${n} timer`),

    companySubject:   (inviter: string, company: string) => `${inviter} inviterte deg til ${company}`,
    companyHeading:   (inviter: string, company: string) => `${inviter} inviterte deg til ${company}`,
    companyPreheader: (company: string) => `Du er nå en del av ${company}.`,
    companyBody:      (role: string) =>
      `<p style="margin:0;">Du ble med som <strong style="color:#14161a;">${role}</strong>. Produksjonene du er medlem av finner du inne i selskapet.</p>`,
    companyFooter:    (inviter: string, company: string) =>
      `${BRAND} · Du fikk denne e-posten fordi ${inviter} la deg til i ${company}.`,
  },
} as const;

function strings(locale: Locale = DEFAULT_LOCALE) {
  return STRINGS[locale] ?? STRINGS[DEFAULT_LOCALE];
}

/** Strips the tags the templates use, for the plain-text part. */
function toText(html: string): string {
  return html
    .replace(/<\/p>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** The inviter's display name, or a neutral stand-in when there isn't one. */
function inviterOr(name: string | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

export interface ProductionInviteInput {
  /** Usually a first name — "Lars". Absent when an API token added them. */
  inviterName?:   string;
  productionName: string;
  companyName:    string;
  url:            string;
  /** Content-ID of the inline image attached alongside, when one was loaded. */
  imageCid?:      string | null;
  locale?:        Locale;
}

export function productionInvite(input: ProductionInviteInput): RenderedMail {
  const t       = strings(input.locale);
  const inviter = inviterOr(input.inviterName, t.someone);

  const heading = t.productionHeading(
    escapeHtml(inviter),
    escapeHtml(input.companyName),
    escapeHtml(input.productionName),
  );
  const body = t.productionBody;

  return {
    subject: t.productionSubject(inviter, input.productionName),
    html:    renderLayout({
      preheader: t.productionPreheader(input.productionName),
      media:     { cid: input.imageCid, name: input.productionName },
      heading,
      body,
      button:    { label: t.openProduction, url: input.url },
      footer:    escapeHtml(t.productionFooter(inviter, input.productionName)),
    }),
    text: [
      toText(heading),
      toText(body),
      input.url,
      t.productionFooter(inviter, input.productionName),
    ].join('\n\n'),
  };
}

export interface VerifyEmailInput {
  url:            string;
  expiresInHours: number;
  locale?:        Locale;
}

/**
 * The only email here with no picture: there is no production or company behind
 * it, just the account itself, and a monogram of nothing would be noise.
 */
export function verifyEmail(input: VerifyEmailInput): RenderedMail {
  const t     = strings(input.locale);
  const hours = t.hours(input.expiresInHours);
  const body  = t.verifyBody(escapeHtml(hours));

  return {
    subject: t.verifySubject,
    html:    renderLayout({
      preheader: t.verifyPreheader(hours),
      heading:   escapeHtml(t.verifyHeading),
      body,
      button:    { label: t.verifyButton, url: input.url },
      footer:    escapeHtml(t.verifyFooter),
    }),
    text: [t.verifyHeading, toText(body), input.url, t.verifyFooter].join('\n\n'),
  };
}

export interface ProductionJoinInviteInput extends ProductionInviteInput {
  /** How long the link is good for, so the mail can say so plainly. */
  expiresInHours: number;
}

/**
 * The invite for someone who has no account yet: the link is a credential, so
 * the mail states its one-use, time-limited nature rather than leaving the
 * reader to discover it when it stops working.
 */
export function productionJoinInvite(input: ProductionJoinInviteInput): RenderedMail {
  const t       = strings(input.locale);
  const inviter = inviterOr(input.inviterName, t.someone);
  const hours   = t.hours(input.expiresInHours);

  const heading = t.productionHeading(
    escapeHtml(inviter),
    escapeHtml(input.companyName),
    escapeHtml(input.productionName),
  );
  const body = t.joinBody(escapeHtml(hours));

  return {
    subject: t.productionSubject(inviter, input.productionName),
    html:    renderLayout({
      preheader: t.joinPreheader(hours),
      media:     { cid: input.imageCid, name: input.productionName },
      heading,
      body,
      button:    { label: t.joinButton, url: input.url },
      footer:    escapeHtml(t.productionFooter(inviter, input.productionName)),
    }),
    text: [
      toText(heading),
      toText(body),
      input.url,
      t.productionFooter(inviter, input.productionName),
    ].join('\n\n'),
  };
}

export interface CompanyInviteInput {
  inviterName?: string;
  companyName:  string;
  role:         'admin' | 'member';
  url:          string;
  imageCid?:    string | null;
  locale?:      Locale;
}

export function companyInvite(input: CompanyInviteInput): RenderedMail {
  const t        = strings(input.locale);
  const inviter  = inviterOr(input.inviterName, t.someone);
  const roleWord = input.role === 'admin' ? t.roleAdmin : t.roleMember;

  const heading = t.companyHeading(escapeHtml(inviter), escapeHtml(input.companyName));
  const body    = t.companyBody(escapeHtml(roleWord));

  return {
    subject: t.companySubject(inviter, input.companyName),
    html:    renderLayout({
      preheader: t.companyPreheader(input.companyName),
      media:     { cid: input.imageCid, name: input.companyName },
      heading,
      body,
      button:    { label: t.openCompany, url: input.url },
      footer:    escapeHtml(t.companyFooter(inviter, input.companyName)),
    }),
    text: [
      toText(heading),
      toText(body),
      input.url,
      t.companyFooter(inviter, input.companyName),
    ].join('\n\n'),
  };
}
