/* The JS half of the plugin, and the app does not use it.

   Focus Simulator has no bundler and no module system — everything is one
   concatenated IIFE (see HANDOFF §2) — so it reaches the plugin the same way it
   reaches every other Capacitor plugin: `window.Capacitor.Plugins.FocusGuard`,
   which the native bridge populates on its own. See src/js/50-guard.js.

   This file exists because npm wants a `main` and because anything that does
   have a bundler should import it rather than poking at the global. */
import { registerPlugin } from '@capacitor/core';

export const FocusGuard = registerPlugin('FocusGuard');
export default FocusGuard;
