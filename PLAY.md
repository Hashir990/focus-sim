# Putting focUS simulator on Google Play

Everything the build itself needs is done and verified on this machine. What is
left is a key that must not live in this repository, a page that must be
published, and a set of declarations that only exist inside the Play Console.

This file is the list, in the order the Console asks for it.

---

## What is already true

| | |
|---|---|
| **Package name** | `com.uswork.focussimulator`. Final. Play records it on the first upload and it can never be changed afterwards, which is why it was settled before any of this. |
| **Version** | Read from `package.json` by `android/app/build.gradle`. 1.5.1 becomes `versionCode` 10501 and `versionName` "1.5.1". `npm run ship:release -- -Bump patch` moves both. |
| **Target API** | 36, on Capacitor 8, AGP 8.13.0, Gradle 8.14.3, JDK 21. `minSdk` is 24. |
| **Signing** | Wired to `android/keystore.properties`, which is git-ignored and does not exist yet. See below. |
| **Shrinking** | Off, deliberately. The accessibility service is found by name; R8 renames it and blocking silently never starts. The note is beside the setting. |
| **The Android project** | In version control, so a signed upload is reproducible from a clone. |
| **Account deletion** | In the app, under Account on Your focus, and on the server. |
| **Blocking and reporting** | In the app, on anybody's profile. |

Build it:

```bash
cd android && ./gradlew :app:bundleRelease
```

The bundle lands in `android/app/build/outputs/bundle/release/`.

`JAVA_HOME` has to point at a JDK 21 (`C:\Program Files\Microsoft\jdk-21...`).
Gradle will not start on Java 25, which is what Android Studio ships.

---

## 1. The upload key — done

It is at `%USERPROFILE%\keys\focus-upload.jks`, RSA 4096, valid 10000 days,
alias `upload`. `android/keystore.properties` points at it and holds the
password; both that file and `*.jks` are git-ignored.

Its SHA-256 is
`81:1F:B5:99:82:66:5C:AB:8F:3C:0E:85:B0:69:77:3A:86:DB:94:F3:EB:97:C6:4D:DE:34:17:85:47:9C:B6:23`
— compare that with what the Console reports on the first upload.

**Back both of them up**, somewhere that is not this machine. The password is
written down in exactly one place. Enrol in **Play App Signing** when the
Console offers it: Google then holds the real signing key and this becomes only
an upload key, which is the version of losing it that can be undone.

---

## 2. The privacy policy — done

GitHub Pages is on, serving `/docs` from `master`:

```
https://hashir990.github.io/focus-sim/privacy.html
```

That is the URL for the Console's **Privacy policy** field. The page is
regenerated from `aboutPrivacy()` on every build, so it cannot drift from the
copy inside the app — but it only *changes* on the web when the repository is
pushed.

### 2a. Account deletion — a second URL, and it is a separate field

An app that lets somebody make an account has to offer deletion **in two
places**: inside the app, and at a web address. This one does the first —
Delete account, in the account panel on Your focus — and the second is:

```
https://hashir990.github.io/focus-sim/delete-account.html
```

That goes in the Console's own **account deletion URL** field, not the privacy
policy one. It was missing: the policy named an email address, and an address
in a policy is not the web resource that field asks for. Google's conditions
for the page are that it names the app, says what is deleted and what is kept,
has no hidden steps and no broken links; it is generated beside the policy by
`tools/make-privacy.mjs` so the owner and the contact address on the two
cannot disagree.

Both pages only reach the web when the repository is pushed.

---

## 3. The declarations, which are the hard part

The blocker is the reason this app gets a careful review. Three of its
permissions are ones Google asks about in writing, and the answers below are
what is actually true of the code.

### Accessibility Service

`BlockService` uses `AccessibilityService` to notice which app comes to the
front. Google's policy allows this for non-accessibility purposes only with a
prominent disclosure and a declaration, and it is the single most common reason
an app blocker is rejected.

* **What it does with it**: reads the package name of the window in front, and,
  when website blocking is on, the address bar of the browser in front.
* **What it stores**: app and site names with times, on the device.
* **What it sends**: nothing.
* The in-app explanation is `guard_service_desc` in
  `native/focus-guard/android/src/main/res/values/strings.xml`. Android shows it
  verbatim on the permission dialog, so it should match whatever is written in
  the Console word for word.
* Record the in-app screen that explains it before asking (the blocking page in
  `51-guard-ui.js`) as the prominent disclosure.

### Device admin

`GuardAdmin` is a `DeviceAdminReceiver` with **no policies at all**. Its only
effect is that the app cannot be uninstalled while blocking is locked. Say
exactly that: it enforces no password rules, wipes nothing, and asks for no
other powers.

### `WRITE_SECURE_SETTINGS`

Declared, never granted on a store install, and used only to grey the screen
while a blocked app is in front. The app checks and silently does without it.
The adb line in the app is for people who want it on their own device. If a
reviewer objects, dropping the permission costs one feature and nothing else.

### `SYSTEM_ALERT_WINDOW`

Not used to draw anything. Since Android 10 a background app may not start an
activity, and holding this permission is one of the few exemptions; it is what
lets the shield appear at all.

### User-generated content

Focus together carries chat, a drawing board and word games between two devices,
peer to peer. There is no server in the middle.

* **Blocking**: on anybody's profile. A blocked person cannot join your room,
  message you, or ask to be friends, and is not told.
* **Reporting**: on the same profile. It opens a mail to the address in
  `REPORT_TO` with the person's name and code.
* Say plainly that messages are direct between devices and are not stored or
  readable by anybody running the app, because the Data safety form will
  otherwise look like it is hiding something.

### Data safety

What actually leaves the device, and only when somebody signs in:

| Collected | Why | Shared |
|---|---|---|
| Email address | account sign-in and password reset | no |
| Username | so friends can find you | no |
| App activity (sessions, puzzles, settings, what you own) | syncing your own history between your own devices | no |

No advertising id, no location, no contacts, no microphone, no camera, no
analytics, no crash reporting, no third-party SDK of any kind. Everything is
encrypted in transit. Deletion is in the app and also by email.

Tick **Yes** for "provides a way to request account deletion" and give the same
URL as the privacy policy; the page says where the in-app button is.

### Content rating and audience

Not aimed at children; the policy says no account should be made for anyone
under 13. The questionnaire will ask about user interaction (yes, chat and
drawing between people), and about digital purchases (no: embers are earned by
using the app and there is no payment of any kind).

---

## 4. First upload, and every one after

**The first one is by hand, and there is no way round it.** The Play Developer
API has no call that creates an app: the listing, the content rating, the data
safety form and the first release all have to be done by somebody signed in to
the Console. No amount of credentials changes that.

1. `cd android && ./gradlew :app:bundleRelease`
2. In the Console, create the app under `com.uswork.focussimulator` and upload
   `app-release.aab` to a **closed test** track, not production.
3. Install from that track on a real phone and check the three things a desktop
   cannot: accessibility blocking, the shield, and the timer notification.
4. Then promote.

**After that it is one command.** `tools/play-upload.mjs` uploads the bundle and
puts it on a track:

```bash
npm run play:upload               # internal
npm run play:upload -- --track alpha
npm run play:upload -- --dry      # say what it would do, touch nothing
```

It wants a service account key: Play Console → Setup → API access → create a
service account, grant it **Release manager** on this app, download the JSON.
Put it outside the repository and point `FOCUS_PLAY_KEY` at it, or drop it at
`android/play-key.json`, which is git-ignored. Everything it does happens
inside a Play *edit*, which is a transaction: a run that fails part way leaves
the listing exactly as it was.

It has never run against the real API, because there is no key yet. The first
time it does, use `--dry` and then the internal track.

`versionCode` has to go up on every upload. It will, as long as the version in
`package.json` does, and the only thing allowed to move that is
`npm run ship:release -- -Bump patch`.
