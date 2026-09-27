/**
 * Regression guard for what goes out over email.
 *
 *     tsx apps/api/src/lib/email/templates.test.ts
 *
 * (Standalone, same convention as docs.test.ts — the repo has no test runner.
 * Exits non-zero on failure.)
 *
 * The templates are pure by design, so this runs with no database, no SMTP and
 * no environment. The escaping checks are the reason this file exists: a
 * production name is text someone typed, and it must never reach a webmail
 * client as markup.
 */

// Loaded through a non-literal specifier, like the other tests here: node
// strips types from the .ts path, and tsc leaves the dynamic import alone.
const mod = await import(process.argv[2] ?? './templates.ts');
const layout = await import(process.argv[3] ?? './layout.ts');

const { productionInvite, companyInvite, productionJoinInvite, verifyEmail } = mod as {
  productionInvite:     (input: Record<string, unknown>) => { subject: string; html: string; text: string };
  companyInvite:        (input: Record<string, unknown>) => { subject: string; html: string; text: string };
  productionJoinInvite: (input: Record<string, unknown>) => { subject: string; html: string; text: string };
  verifyEmail:          (input: Record<string, unknown>) => { subject: string; html: string; text: string };
};
const { monogram, hslToHex, hueFromName } = layout as {
  monogram:    (name: string) => string;
  hslToHex:    (h: number, s: number, l: number) => string;
  hueFromName: (name: string) => number;
};

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function assert(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}

const BASE = {
  inviterName:    'Lars',
  productionName: 'Dancing with the stars',
  companyName:    'Cino',
  url:            'https://app.cino.no/c/cino/p/dancing/dashboard',
};

console.log('email templates');

check('the headline reads "<inviter> from <company> invited you to <production>"', () => {
  const mail = productionInvite(BASE);
  assert(
    mail.html.includes('Lars from Cino invited you to Dancing with the stars'),
    `headline not found in html`,
  );
  assert(mail.subject === 'Lars invited you to Dancing with the stars', `unexpected subject: ${mail.subject}`);
});

check('the product is Cino, and Starling appears nowhere', () => {
  const mails = [productionInvite(BASE), companyInvite({ companyName: 'Cino', role: 'admin', url: 'https://app.cino.no/c/cino' })];
  for (const mail of mails) {
    assert(!/starling/i.test(mail.html), 'Starling leaked into the html');
    assert(!/starling/i.test(mail.text), 'Starling leaked into the text part');
    assert(!/starling/i.test(mail.subject), 'Starling leaked into the subject');
    assert(mail.html.includes('>Cino<'), 'the Cino wordmark is missing');
  }
});

check('an image is embedded by content-id when one was attached', () => {
  const mail = productionInvite({ ...BASE, imageCid: 'invite-image' });
  assert(mail.html.includes('src="cid:invite-image"'), 'the inline image reference is missing');
  assert(mail.html.includes('alt="Dancing with the stars"'), 'the image needs alt text');
  // A remote storage URL would arrive broken — the client sends no cookies.
  assert(!mail.html.includes('/api/storage/'), 'an auth-gated storage URL leaked into the html');
});

check('without an image it falls back to a monogram, not a broken picture', () => {
  const mail = productionInvite(BASE);
  assert(!mail.html.includes('<img'), 'expected no img tag when there is no attachment');
  assert(mail.html.includes('>\n           DW\n         <') || mail.html.includes('DW'), 'expected the DW monogram');
});

check('monogram and colour are derived predictably', () => {
  assert(monogram('Dancing with the stars') === 'DW', `got ${monogram('Dancing with the stars')}`);
  assert(monogram('Cino') === 'C', `got ${monogram('Cino')}`);
  assert(monogram('') === '?', 'empty name should still render something');
  assert(monogram('Åpen Scene') === 'ÅS', `got ${monogram('Åpen Scene')}`);
  assert(hueFromName('Cino') === hueFromName('Cino'), 'hue must be stable for a name');
  assert(/^#[0-9a-f]{6}$/.test(hslToHex(210, 62, 52)), `not a hex colour: ${hslToHex(210, 62, 52)}`);
});

check('the inbox preview line is set and hidden from the body', () => {
  const mail = productionInvite(BASE);
  assert(mail.html.includes('You now have access to Dancing with the stars'), 'preheader text missing');
  assert(mail.html.includes('display:none'), 'preheader should be hidden in the body');
});

check('a production name with markup arrives as text, not as html', () => {
  const mail = productionInvite({ ...BASE, productionName: '<img src=x onerror=alert(1)>' });
  // The payload's own text survives — escaped, inside a text node, where it is
  // inert. What must never appear is the tag itself.
  assert(!mail.html.includes('<img src=x'), 'raw tag leaked into the html body');
  assert(mail.html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the name should appear escaped in full');
});

check('an inviter name with a quote cannot break out of an attribute', () => {
  const mail = productionInvite({ ...BASE, inviterName: 'A" onmouseover="x' });
  assert(!mail.html.includes('onmouseover="x'), 'quote was not escaped');
});

check('a missing inviter falls back instead of rendering undefined', () => {
  const mail = productionInvite({ ...BASE, inviterName: undefined });
  assert(!mail.html.includes('undefined'), 'undefined leaked into the body');
  assert(mail.html.includes('Someone from Cino invited you'), 'expected the fallback name');
});

check('norwegian renders in norwegian', () => {
  const mail = productionInvite({ ...BASE, locale: 'no' });
  assert(mail.html.includes('Lars fra Cino inviterte deg til Dancing with the stars'), 'expected the norwegian headline');
  assert(mail.html.includes('Åpne produksjonen'), 'expected the norwegian button label');
});

check('an unknown locale falls back to english rather than crashing', () => {
  const mail = productionInvite({ ...BASE, locale: 'de' });
  assert(mail.html.includes('Open production'), 'expected the english button label');
});

check('company invite names the inviter and the role in both locales', () => {
  const en = companyInvite({ inviterName: 'Lars', companyName: 'Cino', role: 'admin',  url: 'https://app.cino.no/c/cino' });
  const no = companyInvite({ inviterName: 'Lars', companyName: 'Cino', role: 'member', url: 'https://app.cino.no/c/cino', locale: 'no' });
  assert(en.html.includes('Lars invited you to Cino'), 'expected the english headline');
  assert(en.html.includes('an admin'), 'expected the english role wording');
  assert(no.html.includes('medlem'), 'expected the norwegian role wording');
  assert(en.html.includes('https://app.cino.no/c/cino'), 'company link missing');
});

check('the join invite states its one-use, time-limited nature', () => {
  const mail = productionJoinInvite({ ...BASE, expiresInHours: 1, url: 'https://app.cino.no/invite/tok' });
  assert(mail.html.includes('works once'), 'should say the link is single use');
  assert(mail.html.includes('expires in 1 hour'), 'should say when it expires');
  assert(mail.html.includes('Accept invitation'), 'expected the accept button');

  const norsk = productionJoinInvite({ ...BASE, expiresInHours: 1, url: 'https://app.cino.no/invite/tok', locale: 'no' });
  assert(norsk.html.includes('utløper om 1 time'), 'expected the norwegian expiry wording');
});

check('the hours wording is pluralised in both languages', () => {
  const one  = productionJoinInvite({ ...BASE, expiresInHours: 1,  url: 'u' });
  const many = productionJoinInvite({ ...BASE, expiresInHours: 24, url: 'u' });
  assert(one.html.includes('1 hour') && !one.html.includes('1 hours'), 'singular hour');
  assert(many.html.includes('24 hours'), 'plural hours');

  const noMany = productionJoinInvite({ ...BASE, expiresInHours: 24, url: 'u', locale: 'no' });
  assert(noMany.html.includes('24 timer'), 'norwegian plural');
});

check('the verification email carries the link and no monogram', () => {
  const mail = verifyEmail({ url: 'https://app.cino.no/verify-email/tok', expiresInHours: 24 });
  assert(mail.subject === 'Confirm your email address', `unexpected subject: ${mail.subject}`);
  assert(mail.html.includes('https://app.cino.no/verify-email/tok'), 'link missing');
  assert(mail.html.includes('expires in 24 hours'), 'should state the window');
  // There is no production or company behind this one, so no media block.
  assert(!mail.html.includes('cid:'), 'no inline image belongs here');
  assert(mail.text.includes('https://app.cino.no/verify-email/tok'), 'text part should carry the link');

  const norsk = verifyEmail({ url: 'https://app.cino.no/verify-email/tok', expiresInHours: 24, locale: 'no' });
  assert(norsk.subject === 'Bekreft e-postadressen din', `unexpected norwegian subject: ${norsk.subject}`);
});

check('every template produces a non-empty subject, html and a clean text part', () => {
  const mails = [
    productionInvite(BASE),
    companyInvite({ inviterName: 'Lars', companyName: 'Cino', role: 'member', url: 'https://app.cino.no/c/cino' }),
    productionJoinInvite({ ...BASE, expiresInHours: 1, url: 'https://app.cino.no/invite/tok' }),
    verifyEmail({ url: 'https://app.cino.no/verify-email/tok', expiresInHours: 24 }),
  ];
  for (const mail of mails) {
    assert(mail.subject.trim().length > 0, 'empty subject');
    assert(mail.html.includes('<!doctype html>'), 'html is not a full document');
    assert(mail.text.trim().length > 0, 'empty text part');
    assert(!/<[a-z]/i.test(mail.text), `text part should have no markup: ${mail.text}`);
    assert(mail.text.includes('https://app.cino.no/'), 'text part should carry the link');
  }
});

console.log(failed === 0 ? '\nall ok' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
