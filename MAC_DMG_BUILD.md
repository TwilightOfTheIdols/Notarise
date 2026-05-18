# Notarise macOS DMG Build Guide

This repo is a Vite + React + Tauri v2 app. Use this guide when an agent needs to produce a macOS `.dmg` installer for Notarise.

## Important Constraint

You need macOS to build the macOS app bundle and `.dmg`. Do not try to produce the final `.dmg` from Windows. Use either a physical Mac, a macOS CI runner, or a macOS VM/host that is allowed by Apple licensing.

## Repo Facts

- App name: `Notarise`
- Frontend build: `npm run build`
- Tauri config: `src-tauri/tauri.conf.json`
- Product/version currently configured in Tauri:
  - `productName`: `Notarise`
  - `version`: `0.1.0`
  - `identifier`: `com.notarise.desktop`
- Desktop build scripts in `package.json`:
  - `npm run desktop:dev`
  - `npm run desktop:build`
  - `npm run tauri`

## Required Tools On The Mac

1. Install Xcode Command Line Tools:

```sh
xcode-select --install
```

2. Install Node.js. Prefer the current LTS release.

Check:

```sh
node -v
npm -v
```

3. Install Rust via rustup:

```sh
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
source "$HOME/.cargo/env"
rustc --version
cargo --version
```

4. If building a universal Intel + Apple Silicon app, install both Rust macOS targets:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

## Fresh Build Steps

From the repo root:

```sh
npm install
npm run build
npm run desktop:build -- --bundles dmg
```

Expected output folder:

```sh
src-tauri/target/release/bundle/dmg/
```

Expected artifact pattern:

```sh
src-tauri/target/release/bundle/dmg/Notarise_0.1.0_*.dmg
```

To build a universal `.dmg`:

```sh
npm run desktop:build -- --bundles dmg --target universal-apple-darwin
```

Universal builds require both `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets.

## Local Unsigned Or Ad-Hoc Build

For a private test build, this may be enough:

```sh
npm run desktop:build -- --bundles dmg --no-sign
```

Unsigned or ad-hoc signed builds are not suitable for broad distribution. macOS Gatekeeper may warn users, block launch, or require manual approval in Privacy & Security.

## Distribution-Ready Signing And Notarization

For a `.dmg` that normal users can download and open cleanly, use an Apple Developer account, a Developer ID Application certificate, and Apple notarization.

### Signing Identity

Find installed signing identities:

```sh
security find-identity -v -p codesigning
```

Set the identity in the environment:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name or Company (TEAMID)"
```

Alternatively, configure `bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json`, but prefer environment variables for CI/secrets.

### Notarization Option A: App Store Connect API Key

Set:

```sh
export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY="key-id"
export APPLE_API_KEY_PATH="/absolute/path/AuthKey_KEYID.p8"
```

Then build:

```sh
npm run desktop:build -- --bundles dmg
```

### Notarization Option B: Apple ID App-Specific Password

Set:

```sh
export APPLE_ID="developer@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

Then build:

```sh
npm run desktop:build -- --bundles dmg
```

## Verifying The Artifact

After build:

```sh
ls -lh src-tauri/target/release/bundle/dmg/
```

Check signature on the app bundle:

```sh
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/Notarise.app
spctl --assess --type execute --verbose src-tauri/target/release/bundle/macos/Notarise.app
```

Check notarization/stapling on the `.dmg`:

```sh
spctl --assess --type open --verbose src-tauri/target/release/bundle/dmg/Notarise_0.1.0_*.dmg
```

Manual smoke test:

1. Open the `.dmg`.
2. Drag `Notarise.app` into Applications.
3. Launch from Applications.
4. Confirm the app opens without a Gatekeeper block.
5. Create/edit a cell.
6. Quit and reopen.
7. Confirm local document persistence still loads.

## CI Notes

For GitHub Actions, use a `macos-*` runner. The basic sequence is:

```sh
npm ci
npm run build
npm run desktop:build -- --bundles dmg
```

For signed CI builds, secrets must provide the Apple signing certificate/keychain setup plus notarization credentials. Tauri supports signing via an installed keychain identity or environment variables. Keep all Apple secrets in CI secrets, not in the repo.

## Common Failure Points

- Building on Windows: cannot produce the final macOS `.dmg`.
- Missing Rust: `cargo` or `rustc` not found.
- Missing Xcode tools: linker or `xcrun` errors.
- Universal target missing: install both Apple Rust targets.
- Bad signing identity: certificate is not in Keychain Access under `My Certificates`, or `security find-identity` does not list it.
- Notarization failure: wrong Apple credentials, missing Team ID, expired certificate, or Apple account not enrolled in the paid Developer Program.
- Gatekeeper warning after upload/download: build was not signed and notarized, or notarization was not stapled/recognized.

## Official References Checked

- Tauri v2 DMG guide: https://v2.tauri.app/distribute/dmg/
- Tauri v2 prerequisites: https://v2.tauri.app/start/prerequisites/
- Tauri v2 distribution overview: https://v2.tauri.app/distribute/
- Tauri v2 macOS app bundle guide: https://v2.tauri.app/distribute/macos-application-bundle/
- Tauri v2 CLI reference: https://v2.tauri.app/reference/cli/
- Tauri v2 macOS signing/notarization guide: https://v2.tauri.app/distribute/sign/macos/
