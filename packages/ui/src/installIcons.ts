import { addCollection } from '@iconify/vue'
import { mdiSubset } from './iconData'

/**
 * Registers the bundled MDI subset with Iconify.
 *
 * `<Icon>` resolves names from registered collections first and only falls back
 * to api.iconify.design for what it can't find locally. Registering up front
 * means the icons the app actually uses never leave the bundle: no third-party
 * request on first paint, no icons popping in a beat late, and chrome that
 * still renders offline or behind a restrictive CSP.
 *
 * Import for side effect, alongside the other app-wide setup:
 *
 *     import '@starling/ui/installIcons'
 *
 * The subset is generated from a scan of the source tree — see
 * scripts/build-icons.mjs. A name that isn't in it falls back to the network as
 * before, so nothing breaks if the generator hasn't been re-run.
 */
addCollection(mdiSubset)

export { mdiSubset }
