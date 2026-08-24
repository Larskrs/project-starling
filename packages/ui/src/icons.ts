/**
 * Curated Material Design Icons offered by IconPicker.
 *
 * A hand-picked catalogue rather than the whole 7000-icon MDI set: the point is
 * for someone labelling a track type or a camera to find something in seconds,
 * not to browse. Every name here is verified to exist in the `mdi` collection —
 * Iconify renders nothing at all for a name it can't resolve, so a typo would
 * show up as an invisible icon rather than an error.
 *
 * `keywords` is extra search vocabulary; the icon's own name is always searched
 * too, so only add words the name doesn't already contain.
 */

export interface IconGroup {
  id: string
  label: string
}

export interface IconEntry {
  name: string
  group: string
  /** Extra search vocabulary; the icon's own name is always searched too. */
  keywords?: string
}

export const ICON_GROUPS: IconGroup[] = [
  { id: 'production', label: 'Production' },
  { id: 'audio',      label: 'Audio' },
  { id: 'graphics',   label: 'Graphics & text' },
  { id: 'people',     label: 'People' },
  { id: 'time',       label: 'Time & markers' },
  { id: 'status',     label: 'Shapes & status' },
  { id: 'objects',    label: 'Objects' },
]

export const ICONS: IconEntry[] = [
  // ── Production ────────────────────────────────────────────────────────────
  { name: 'mdi:video-outline',           group: 'production', keywords: 'camera film shot' },
  { name: 'mdi:video',                   group: 'production', keywords: 'camera film shot' },
  { name: 'mdi:camera-outline',          group: 'production', keywords: 'photo stills' },
  { name: 'mdi:cctv',                    group: 'production', keywords: 'security surveillance camera' },
  { name: 'mdi:webcam',                  group: 'production', keywords: 'camera remote' },
  { name: 'mdi:movie-open-outline',      group: 'production', keywords: 'film cinema' },
  { name: 'mdi:movie-roll',              group: 'production', keywords: 'film reel' },
  { name: 'mdi:filmstrip',               group: 'production', keywords: 'film frames' },
  { name: 'mdi:television',              group: 'production', keywords: 'tv screen broadcast' },
  { name: 'mdi:television-play',         group: 'production', keywords: 'tv broadcast playout' },
  { name: 'mdi:broadcast',               group: 'production', keywords: 'live on air transmit' },
  { name: 'mdi:antenna',                 group: 'production', keywords: 'signal transmit rf' },
  { name: 'mdi:satellite-uplink',        group: 'production', keywords: 'feed remote transmit' },
  { name: 'mdi:record-rec',              group: 'production', keywords: 'recording capture' },
  { name: 'mdi:record-circle-outline',   group: 'production', keywords: 'recording capture' },
  { name: 'mdi:projector',               group: 'production', keywords: 'beamer projection' },
  { name: 'mdi:projector-screen-outline', group: 'production', keywords: 'projection display' },
  { name: 'mdi:monitor',                 group: 'production', keywords: 'screen display preview' },
  { name: 'mdi:monitor-dashboard',       group: 'production', keywords: 'multiview screens' },
  { name: 'mdi:drone',                   group: 'production', keywords: 'aerial camera copter' },
  { name: 'mdi:crane',                   group: 'production', keywords: 'jib boom camera' },
  { name: 'mdi:remote',                  group: 'production', keywords: 'control' },

  // ── Audio ─────────────────────────────────────────────────────────────────
  { name: 'mdi:microphone',              group: 'audio', keywords: 'mic voice' },
  { name: 'mdi:microphone-outline',      group: 'audio', keywords: 'mic voice' },
  { name: 'mdi:microphone-variant',      group: 'audio', keywords: 'mic handheld voice' },
  { name: 'mdi:headphones',              group: 'audio', keywords: 'monitor cans' },
  { name: 'mdi:speaker',                 group: 'audio', keywords: 'monitor pa output' },
  { name: 'mdi:volume-high',             group: 'audio', keywords: 'loud level sound' },
  { name: 'mdi:music',                   group: 'audio', keywords: 'song cue' },
  { name: 'mdi:music-note',              group: 'audio', keywords: 'song cue' },
  { name: 'mdi:metronome',               group: 'audio', keywords: 'bpm tempo beat click' },
  { name: 'mdi:waveform',                group: 'audio', keywords: 'audio signal' },
  { name: 'mdi:sine-wave',               group: 'audio', keywords: 'tone signal' },
  { name: 'mdi:equalizer',               group: 'audio', keywords: 'eq mix levels' },
  { name: 'mdi:tune-vertical',           group: 'audio', keywords: 'fader mixer levels' },
  { name: 'mdi:playlist-music-outline',  group: 'audio', keywords: 'queue tracks' },
  { name: 'mdi:album',                   group: 'audio', keywords: 'record vinyl' },
  { name: 'mdi:piano',                   group: 'audio', keywords: 'keys instrument' },
  { name: 'mdi:guitar-electric',         group: 'audio', keywords: 'instrument band' },
  { name: 'mdi:trumpet',                 group: 'audio', keywords: 'brass instrument band' },
  { name: 'mdi:violin',                  group: 'audio', keywords: 'strings instrument orchestra' },
  { name: 'mdi:ear-hearing',             group: 'audio', keywords: 'listen monitor ifb' },
  { name: 'mdi:bullhorn-outline',        group: 'audio', keywords: 'announce megaphone' },

  // ── Graphics & text ───────────────────────────────────────────────────────
  { name: 'mdi:format-text',             group: 'graphics', keywords: 'type typography' },
  { name: 'mdi:text-box-outline',        group: 'graphics', keywords: 'document notes' },
  { name: 'mdi:script-text-outline',     group: 'graphics', keywords: 'manuscript dialogue lines' },
  { name: 'mdi:subtitles-outline',       group: 'graphics', keywords: 'captions text lower third' },
  { name: 'mdi:closed-caption-outline',  group: 'graphics', keywords: 'subtitles accessibility' },
  { name: 'mdi:image-outline',           group: 'graphics', keywords: 'picture still' },
  { name: 'mdi:shape-outline',           group: 'graphics', keywords: 'vector element' },
  { name: 'mdi:palette-outline',         group: 'graphics', keywords: 'colour design' },
  { name: 'mdi:layers-outline',          group: 'graphics', keywords: 'stack group set' },
  { name: 'mdi:vector-square',           group: 'graphics', keywords: 'shape frame' },
  { name: 'mdi:label-outline',           group: 'graphics', keywords: 'tag name' },
  { name: 'mdi:sticker-outline',         group: 'graphics', keywords: 'badge overlay' },
  { name: 'mdi:card-text-outline',       group: 'graphics', keywords: 'lower third caption' },
  { name: 'mdi:presentation',            group: 'graphics', keywords: 'slides deck' },
  { name: 'mdi:chart-line',              group: 'graphics', keywords: 'graph data results' },
  { name: 'mdi:chart-bar',               group: 'graphics', keywords: 'graph data results' },
  { name: 'mdi:table',                   group: 'graphics', keywords: 'grid data standings' },
  { name: 'mdi:animation-outline',       group: 'graphics', keywords: 'motion sequence' },

  // ── People ────────────────────────────────────────────────────────────────
  { name: 'mdi:account-outline',         group: 'people', keywords: 'person user' },
  { name: 'mdi:account-group-outline',   group: 'people', keywords: 'team crowd panel' },
  { name: 'mdi:account-tie-outline',     group: 'people', keywords: 'host presenter anchor' },
  { name: 'mdi:account-voice',           group: 'people', keywords: 'speaker commentary voiceover' },
  { name: 'mdi:human-greeting',          group: 'people', keywords: 'guest welcome' },
  { name: 'mdi:human-male-board',        group: 'people', keywords: 'presenter explainer' },
  { name: 'mdi:hand-wave-outline',       group: 'people', keywords: 'cue signal greeting' },
  { name: 'mdi:face-man-outline',        group: 'people', keywords: 'portrait talent' },
  { name: 'mdi:podium',                  group: 'people', keywords: 'stage speech lectern' },
  { name: 'mdi:seat-outline',            group: 'people', keywords: 'audience chair' },

  // ── Time & markers ────────────────────────────────────────────────────────
  { name: 'mdi:clock-outline',           group: 'time', keywords: 'time schedule' },
  { name: 'mdi:timer-outline',           group: 'time', keywords: 'duration countdown' },
  { name: 'mdi:timer-sand',              group: 'time', keywords: 'wait countdown hourglass' },
  { name: 'mdi:alarm',                   group: 'time', keywords: 'reminder cue' },
  { name: 'mdi:calendar-outline',        group: 'time', keywords: 'date schedule' },
  { name: 'mdi:flag-outline',            group: 'time', keywords: 'marker milestone' },
  { name: 'mdi:flag-checkered',          group: 'time', keywords: 'finish end marker' },
  { name: 'mdi:bookmark-outline',        group: 'time', keywords: 'marker saved' },
  { name: 'mdi:map-marker-outline',      group: 'time', keywords: 'location point pin' },
  { name: 'mdi:pin-outline',             group: 'time', keywords: 'fixed marker' },
  { name: 'mdi:ray-start-arrow',         group: 'time', keywords: 'start in point begin' },
  { name: 'mdi:ray-end',                 group: 'time', keywords: 'end out point finish' },
  { name: 'mdi:timeline-outline',        group: 'time', keywords: 'sequence order' },
  { name: 'mdi:ruler',                   group: 'time', keywords: 'measure scale strip' },
  { name: 'mdi:calendar-clock',          group: 'time', keywords: 'schedule rundown' },

  // ── Shapes & status ───────────────────────────────────────────────────────
  { name: 'mdi:circle-outline',          group: 'status', keywords: 'dot round shape' },
  { name: 'mdi:square-outline',          group: 'status', keywords: 'box shape' },
  { name: 'mdi:triangle-outline',        group: 'status', keywords: 'shape' },
  { name: 'mdi:hexagon-outline',         group: 'status', keywords: 'shape' },
  { name: 'mdi:star-outline',            group: 'status', keywords: 'favourite highlight' },
  { name: 'mdi:heart-outline',           group: 'status', keywords: 'favourite like' },
  { name: 'mdi:lightning-bolt-outline',  group: 'status', keywords: 'fast power action' },
  { name: 'mdi:fire',                    group: 'status', keywords: 'hot highlight urgent' },
  { name: 'mdi:alert-outline',           group: 'status', keywords: 'warning caution' },
  { name: 'mdi:information-outline',     group: 'status', keywords: 'info note' },
  { name: 'mdi:check-circle-outline',    group: 'status', keywords: 'done ok approved' },
  { name: 'mdi:close-circle-outline',    group: 'status', keywords: 'cancel removed' },
  { name: 'mdi:eye-outline',             group: 'status', keywords: 'visible preview watch' },
  { name: 'mdi:eye-off-outline',         group: 'status', keywords: 'hidden invisible' },
  { name: 'mdi:help-circle-outline',     group: 'status', keywords: 'question unknown tbd' },
  { name: 'mdi:asterisk',                group: 'status', keywords: 'note footnote misc' },

  // ── Objects ───────────────────────────────────────────────────────────────
  { name: 'mdi:lightbulb-on-outline',    group: 'objects', keywords: 'light idea lamp' },
  { name: 'mdi:spotlight-beam',          group: 'objects', keywords: 'light stage lamp' },
  { name: 'mdi:weather-sunny',           group: 'objects', keywords: 'day outdoor light' },
  { name: 'mdi:weather-night',           group: 'objects', keywords: 'evening dark' },
  { name: 'mdi:cloud-outline',           group: 'objects', keywords: 'remote storage' },
  { name: 'mdi:wifi',                    group: 'objects', keywords: 'wireless network' },
  { name: 'mdi:cable-data',              group: 'objects', keywords: 'wire connection sdi' },
  { name: 'mdi:usb',                     group: 'objects', keywords: 'connector device' },
  { name: 'mdi:server-outline',          group: 'objects', keywords: 'machine rack backend' },
  { name: 'mdi:cog-outline',             group: 'objects', keywords: 'settings config' },
  { name: 'mdi:wrench-outline',          group: 'objects', keywords: 'tools fix rig' },
  { name: 'mdi:package-variant-closed',  group: 'objects', keywords: 'box asset delivery' },
  { name: 'mdi:phone-outline',           group: 'objects', keywords: 'call line' },
  { name: 'mdi:email-outline',           group: 'objects', keywords: 'mail message' },
  { name: 'mdi:link-variant',            group: 'objects', keywords: 'url reference' },
  { name: 'mdi:key-outline',             group: 'objects', keywords: 'access secret' },
  { name: 'mdi:shield-outline',          group: 'objects', keywords: 'safety protected' },
  { name: 'mdi:rocket-launch-outline',   group: 'objects', keywords: 'launch start go' },
  { name: 'mdi:earth',                   group: 'objects', keywords: 'world global news' },
  { name: 'mdi:map-outline',             group: 'objects', keywords: 'location geography' },
  { name: 'mdi:car-outline',             group: 'objects', keywords: 'vehicle travel' },
  { name: 'mdi:airplane',                group: 'objects', keywords: 'travel flight' },
  { name: 'mdi:soccer',                  group: 'objects', keywords: 'sport football match' },
  { name: 'mdi:basketball',              group: 'objects', keywords: 'sport match' },
  { name: 'mdi:whistle',                 group: 'objects', keywords: 'referee sport signal' },
  { name: 'mdi:trophy-outline',          group: 'objects', keywords: 'winner award sport' },
  { name: 'mdi:stadium-outline',         group: 'objects', keywords: 'venue arena sport' },
  { name: 'mdi:food-fork-drink',         group: 'objects', keywords: 'break catering meal' },
  { name: 'mdi:coffee-outline',          group: 'objects', keywords: 'break pause' },
  { name: 'mdi:weather-partly-cloudy',   group: 'objects', keywords: 'forecast weather' },
]

/** `mdi:video-outline` → `Video outline`. MDI's own names are the shared
 *  vocabulary for these icons, so they're shown as-is rather than translated. */
export function iconLabel(name: string | null | undefined): string {
  if (!name) return ''
  const words = name.replace(/^mdi:/, '').replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `mdi:video-outline` → `video outline`, the words the search box matches against. */
function searchText(icon: IconEntry): string {
  return `${icon.name.slice(4).replace(/-/g, ' ')} ${icon.keywords ?? ''}`.toLowerCase()
}

const SEARCH_INDEX = new Map<string, string>(ICONS.map(i => [i.name, searchText(i)]))

/** Filter the catalogue by a free-text query; empty query returns everything. */
export function searchIcons(query: string): IconEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return ICONS
  return ICONS.filter((icon) => {
    const haystack = SEARCH_INDEX.get(icon.name) ?? ''
    return terms.every(term => haystack.includes(term))
  })
}
