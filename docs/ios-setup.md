# BodyAtlas iOS Shell — Setup & Run Guide

The iOS app is a thin Capacitor shell in **remote-URL mode**: the WKWebView loads the
live site at `https://bodyatlas.okdtsk.dev`, so web deploys update the app instantly and
the existing same-origin cookie session works natively. The one native capability is the
custom `HealthSync` plugin, which reads Apple Health sleep and body-mass/body-fat samples
for import via Settings → Apple Health.

## Prerequisites

- macOS with **Xcode** (15+) and its iOS Simulator runtimes installed.
- An Apple ID. A **free** Apple account is enough for simulator and personal-device runs;
  a paid Apple Developer account is only needed for TestFlight (deferred).
- Node dependencies installed at the repo root (`npm install`). CocoaPods is **not**
  required — the project uses Swift Package Manager (`ios/App/CapApp-SPM`).

## Build & open

```sh
npm run cap:sync   # builds the web app and syncs the Capacitor iOS project
npm run cap:open   # opens ios/App/App.xcodeproj in Xcode
```

`cap:sync` is only needed after changing `capacitor.config.ts` or updating Capacitor
packages. Web-only changes never require a new app build — the shell loads the deployed
site.

## One-time Xcode configuration (signing)

1. In Xcode, select the **App** project in the navigator, then the **App** target.
2. Open **Signing & Capabilities**.
3. Set **Team** to your Apple ID team (a free "Personal Team" works).
4. Confirm the **HealthKit** capability is listed (it is wired via
   `App.entitlements`; if Xcode complains, re-add HealthKit from "+ Capability").
5. If the bundle ID `com.okdtsk.bodyatlas` collides under a personal team, change it to
   any unique ID — the shell does not depend on the bundle ID.

## Run

1. Pick a destination (an iOS Simulator, or your device via cable/Wi-Fi) and press **Run**.
2. First launch shows the live site; **sign in with Google** inside the WebView.

### Google OAuth caveat (known risk)

Google sometimes blocks OAuth inside embedded WebViews with a
**`403 disallowed_useragent`** error. Capacitor's WKWebView usually passes, but if you hit
that screen, report it — the planned fix is presenting the OAuth URL in
`SFSafariViewController` instead (not built yet; flagged in the iOS shell plan). There is
no workaround worth doing by hand: signing in via the separate Safari app does **not**
share cookies with the shell's WKWebView.

## Apple Health import

1. On the **simulator**, open the built-in **Health** app first and add sample data
   (Browse → Sleep / Body Measurements → Add Data) so there is something to import.
2. In BodyAtlas: **Settings → Apple Health → Connect Apple Health** — iOS shows the
   HealthKit permission sheet; enable Sleep, Weight, and Body Fat Percentage reads.
3. Tap **Import last 30 days**. The app reads HealthKit samples, merges fragmented sleep
   into nights on the web side, dedupes against existing BodyAtlas records by local day
   (sleep keyed by woke-day, measurements by measured-day), and posts only new days.
   Imported measurements keep the **original sample timestamps**, so re-running the
   import is idempotent.
4. The result line reports imported counts; if some records fail to save, it also reports
   the failure count (the successes are kept — re-import later fills the gaps).

Notes:
- The Apple Health section only renders inside the native shell
  (`isNativeShell()`); it never appears in a browser.
- Direction is one-way: Apple Health → BodyAtlas. Workouts are not synced (HealthKit
  workouts carry no sets/reps, so they cannot map onto the strength model).

## TestFlight (deferred)

Distribution via TestFlight needs a paid Apple Developer account and an App Store Connect
record. Out of scope for now; the shell is for personal device installs.

## Troubleshooting

- **Plugin not found (`HealthSync` undefined in JS):** custom app-target plugins are not
  auto-discovered in Capacitor 8 — registration happens in
  `ios/App/App/MainViewController.swift` (`capacitorDidLoad` →
  `registerPluginType(HealthSyncPlugin.self)`). Confirm `Main.storyboard` still uses
  `MainViewController` as the custom class.
- **Blank screen on launch:** the shell needs network (remote-URL mode); check the device
  is online and `https://bodyatlas.okdtsk.dev` is reachable.
- **Headless build check** (no signing):
  ```sh
  cd ios/App && xcodebuild -project App.xcodeproj -scheme App \
    -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
  ```
