import { ref } from 'vue'

// Same storage key as the main app, so language choice follows the user
// across the homepage and /app.
const STORAGE_KEY = 'starling-locale'

export type Locale = 'en' | 'no'

const messages = {
  en: {
    'nav.signIn':        'Sign in',
    'nav.getStarted':    'Get started',
    'nav.openApp':       'Open the app',
    'hero.title':        'Plan, edit and play back your productions — together.',
    'hero.lede':         'Cino is the collaborative workspace for live productions: shared timelines, synchronized playback and all your source material in one place.',
    'welcome.eyebrow':   'Welcome back',
    'welcome.title':     'Good to see you, {name}.',
    'welcome.lede':      'Your productions are right where you left them.',
    'welcome.launch':    'Launch Cino',
    'features.title':    'Everything your production needs',
    'features.timelines.title': 'Timelines that stay in sync',
    'features.timelines.text':  'Build show timelines with tracks and clips, and watch every change appear live for the whole team — playhead included.',
    'features.tracks.title':    'Tracks that fit your workflow',
    'features.tracks.text':     'Configure track types with rulers, metronomes, text-to-speech and more, or start from ready-made presets.',
    'features.files.title':     'All your files in one place',
    'features.files.text':      'Organize audio, video and documents in production folders, and drop sources straight onto the timeline.',
    'features.teams.title':     'Built for teams',
    'features.teams.text':      "Companies, productions, roles and permissions — everyone sees exactly what they need, nothing they don't.",
  },
  no: {
    'nav.signIn':        'Logg inn',
    'nav.getStarted':    'Kom i gang',
    'nav.openApp':       'Åpne appen',
    'hero.title':        'Planlegg, rediger og spill av produksjonene dine — sammen.',
    'hero.lede':         'Cino er samarbeidsflaten for liveproduksjoner: delte tidslinjer, synkronisert avspilling og alt kildematerialet ditt på ett sted.',
    'welcome.eyebrow':   'Velkommen tilbake',
    'welcome.title':     'Godt å se deg, {name}.',
    'welcome.lede':      'Produksjonene dine er akkurat der du forlot dem.',
    'welcome.launch':    'Start Cino',
    'features.title':    'Alt produksjonen din trenger',
    'features.timelines.title': 'Tidslinjer som holder seg synkronisert',
    'features.timelines.text':  'Bygg tidslinjer med spor og klipp, og se hver endring dukke opp live for hele teamet — spillehodet inkludert.',
    'features.tracks.title':    'Spor som passer arbeidsflyten din',
    'features.tracks.text':     'Sett opp sportyper med linjaler, metronom, tekst-til-tale og mer, eller start fra ferdige forhåndsinnstillinger.',
    'features.files.title':     'Alle filene dine på ett sted',
    'features.files.text':      'Organiser lyd, video og dokumenter i produksjonsmapper, og dra kilder rett inn på tidslinjen.',
    'features.teams.title':     'Laget for team',
    'features.teams.text':      'Selskaper, produksjoner, roller og tilganger — alle ser akkurat det de trenger, ikke noe mer.',
  },
} as const satisfies Record<Locale, Record<string, string>>

export type MessageKey = keyof typeof messages.en

const stored = localStorage.getItem(STORAGE_KEY)
const locale = ref<Locale>(stored === 'no' ? 'no' : 'en')

export function useLocale() {
  function setLocale(lang: Locale) {
    locale.value = lang
    localStorage.setItem(STORAGE_KEY, lang)
  }

  function toggleLocale() {
    setLocale(locale.value === 'en' ? 'no' : 'en')
  }

  function t(key: MessageKey, params?: Record<string, string>): string {
    let out: string = messages[locale.value][key] ?? messages.en[key]
    for (const [name, value] of Object.entries(params ?? {})) {
      out = out.replaceAll(`{${name}}`, value)
    }
    return out
  }

  return { locale, setLocale, toggleLocale, t }
}
