# focus-guard

The Android half of two features that a web view cannot do on its own:

* **A timer notification you can drive.** An ongoing notification with a live
  countdown the *system* renders (`setChronometerCountDown`), and Stop / Pause /
  Continue buttons that work whether or not the app's process is still alive.
* **App blocking**, built the way ScreenZen builds it: an accessibility service
  watches which app comes to the front, and a full-screen shield stands in front
  of the ones you have chosen — a pause you have to sit through, and then a
  choice between closing it and a short, counted allowance.

It is a **local** Capacitor plugin (`file:native/focus-guard` in the app's
package.json) rather than a folder inside `android/`, because `android/` is
generated and git-ignored — `npm run cap:add:android` throws it away and makes
it again. Everything here survives that.

`npx cap sync` copies it into the Gradle project and merges its manifest, so the
permissions and services below need no edit to the app's own manifest.

## What it needs from the person using it

| Permission | Why | Where it is asked |
|---|---|---|
| Notifications | to post anything at all | a normal runtime prompt |
| Display over other apps | an accessibility service may only start an activity in the background if the app holds this | Settings, deep-linked |
| Accessibility service | the only reliable way to know which app just came to the front | Settings, deep-linked |

Nothing is asked for until app blocking is switched on, and the notification
half works with only the first.

## Files

    FocusGuardPlugin.java   the bridge: config, app list, timer mirror, commands
    GuardStore.java         SharedPreferences, and every decision made from it
    TimerNotice.java        building and posting the ongoing notification
    NoticeReceiver.java     the notification's buttons, and the end-of-block alarm
    BlockService.java       AccessibilityService: what is in front, right now
    ShieldActivity.java     the intervention screen
    RingView.java           the breathing ring on it
