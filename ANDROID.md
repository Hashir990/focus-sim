# Running Focus Simulator on Android

Capacitor is already set up in this project (`capacitor.config.json`,
`@capacitor/android` in `package.json`), so this is mostly installing Android's
toolchain once and then two commands each time.

The app itself needs nothing from Android — no network, no permissions, no
account. It is the same `dist/index.html` running in a system WebView, with its
data in local storage on the phone.

---

## One-time setup

### 1. Install Android Studio

Download from <https://developer.android.com/studio> and run it. On first launch
accept the standard setup — it installs the Android SDK, platform tools and an
emulator image.

Then check three things are present under **Settings → Languages & Frameworks →
Android SDK**:

- **SDK Platforms:** Android 14 (API 34) or newer
- **SDK Tools:** *Android SDK Build-Tools*, *Android SDK Platform-Tools*,
  *Android Emulator*
- **SDK Tools → SDK Command-line Tools** — Gradle wants these and the installer
  does not always tick it

### 2. Install a JDK

Android Studio ships one (JetBrains Runtime) and Gradle will use it. If you build
from the terminal instead, install JDK 17 and set `JAVA_HOME` to it.

### 3. Add the Android project

In the project folder:

```
npm install
npm run cap:add:android
```

That builds `dist/`, then creates an `android/` directory — a real Gradle project
with the web build copied inside it. It is generated, so you don't need to keep
it in version control; `npm run cap:add:android` makes it again.

---

## Each time you want to run it

```
npm run android
```

Which does two things: `npx cap sync` (rebuild `dist/`, copy it into the Android
project, update plugins) and `npx cap open android` (open that project in Android
Studio).

Then in Android Studio:

1. Wait for **Gradle sync** to finish — the progress bar at the bottom. First run
   downloads the Gradle distribution and takes a few minutes.
2. Pick a target in the device dropdown in the toolbar:
   - **A real phone:** enable *Developer options* (tap *Build number* seven times
     under *About phone*), turn on *USB debugging*, plug it in, accept the
     prompt on the phone. It appears in the dropdown by name.
   - **An emulator:** *Device Manager → Create device* → pick Pixel 7 → a system
     image with API 34 → Finish.
3. Press **Run** (the green ▶, or Shift+F10).

It installs and launches. Editing the app afterwards means running
`npm run cap:sync` again and pressing Run — Capacitor copies the new `dist/` in;
Android Studio alone will keep building the old one.

---

## Updates on the phone — what actually happens

Three different things get confused here, so, plainly:

- **The desktop app updates itself.** `electron-updater` downloads the new
  installer in the background and puts it in at the next ordinary exit. Nobody
  visits GitHub.
- **The phone app cannot.** A web view cannot replace the assets it was
  installed with, any more than a copied `index.html` can overwrite itself. So
  the in-app notice is a *link* — that is why **Get update** always takes you to
  GitHub. It is not a bug; it is the only thing that code can do.
- **The phone was not even noticing.** That one *was* a bug. A Capacitor web view
  has an origin of its own, so fetching `latest.json` from GitHub is
  cross-origin, and GitHub redirects release downloads to a host that does not
  allow it. The request was refused before it left the device and the app quietly
  concluded there was no news. Fixed by `CapacitorHttp.enabled` in
  `capacitor.config.json`, which sends that fetch through the native HTTP stack
  where CORS does not apply. Re-run `npx cap sync` after pulling this.

If you want the phone to genuinely update itself, pick one:

| Route | What it costs |
|---|---|
| **Play Store** (or any store) | A developer account and a review; the store then updates everybody. The normal answer. |
| **Live updates** — `npm install @capgo/capacitor-updater` | Swaps the *web bundle* at runtime, so everything in `dist/` updates without reinstalling. Native code changes still need a new APK. |
| **Hand over a new APK** | Free, and what you are doing now. |

## Building an APK to hand to somebody

**Debug** (fine for yourself and for testing, not for a store):

```
cd android
./gradlew assembleDebug          # Windows: gradlew.bat assembleDebug
```

The file lands in `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to
a phone and open it — Android will ask permission to install from an unknown
source.

Or from inside Android Studio, which is easier to find than it looks — the menu
item people hunt for is **not** "Generate Signed Bundle":

**Build → Build Bundle(s) / APK(s) → Build APK(s)**

It builds and then puts a notification in the bottom-right corner saying *APK(s)
generated successfully* with a **locate** link in it. That link opens the folder.
If you miss the notification it is gone — the file is still at
`android/app/build/outputs/apk/debug/app-debug.apk`, and that path does not
change, so it is worth bookmarking rather than hunting for the popup.

**Release** needs signing. In Android Studio: **Build → Generate Signed Bundle /
APK → APK**, create a keystore when it asks, and keep that keystore somewhere
safe — lose it and you cannot update the app on Play later. The signed file lands
in `android/app/build/outputs/apk/release/app-release.apk`.

---

## Things that go wrong

- **"SDK location not found"** — open the project in Android Studio once and let
  it write `android/local.properties`, or create it yourself with
  `sdk.dir=/path/to/Android/Sdk`.
- **Gradle sync fails on a fresh install** — nearly always the missing
  *SDK Command-line Tools*. Install it and sync again.
- **The app launches but shows the old version** — you skipped `cap sync`. Use
  `npm run android` rather than pressing Run on its own.
- **A blank screen** — check `dist/index.html` exists and `webDir` in
  `capacitor.config.json` still says `dist`. `chrome://inspect` on a desktop
  Chrome will show the WebView's console for a connected device.
- **No sound** — the ambience tracks are in `dist/audio/`, and `cap sync` copies
  whatever is in `dist/`. If you cleaned `dist/` by hand, rebuild before syncing.

---

### 4. Notifications, so a block survives the Home button

One plugin, once:

```
npm install @capacitor/local-notifications
npx cap sync
```

Without it the app works exactly as before and simply never posts anything —
`45-notify.js` looks for the plugin and does nothing at all when it is missing,
which is also why the desktop and web builds are unaffected.

With it, starting a block posts an **ongoing notification** saying what is
running and when it ends, and hands Android a **scheduled notification** for the
end time. The scheduled one is the important half: Android fires it whether or
not the app was ever given another instruction, so the end of a block still
announces itself from a pocket.

The ongoing one deliberately shows an end time rather than a live countdown. A
notification the app has to wake up and rewrite every second is wrong the moment
the app is frozen — which is precisely when it is the only thing you can see.

## Worth knowing about the phone build

- **Pressing Home does not stop the timer.** The countdown is wall-clock
  arithmetic against the end time rather than a count of ticks, so a block that
  runs with the screen off comes back with the right number on it. The running
  session and the embers it has earned are written to disk on the way out and
  brought up to date the moment you return — Android throttles background
  timers to nothing within a minute or two, so neither is left to chance.
- **The screen stays awake** during a session (the app asks for a wake lock) and
  releases it when the timer stops.
- **Effects** in the menu turns the weather off. On a mid-range phone that is the
  single biggest thing you can do for battery.
- **Focus together** works over the same connection as on desktop, so two phones
  on the same wifi can share a timer.
- **Backups** move between phone and desktop: *Menu → Your data → Export backup*
  writes a `.json` that *Import backup* reads on any copy.
