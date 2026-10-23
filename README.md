<img src="assets/icon.svg" width="64" height="64" alt="">

# Coda experiment

A plain browser-player test page plus real YouTube Music public-request probes. This is a feasibility experiment, not a finished YouTube Music player. Targets: Zen on PC and Chrome on Android; the owner has Premium.

Read the [detailed experiment plan](docs/experiment-plan.md), [research](docs/investigation.md), and [measured results](docs/experiment-results.md).

## Run the page

Node 22 or newer:

```sh
npm ci
npm start
```

Open `http://127.0.0.1:8493`. The server binds only to loopback and serves an explicit list of public files. It never serves the repository directory. The page has generated quiet tones, a queue, play/pause/seek, media-key handlers, panel navigation, public search/playlist reads, player-response inspection, and a device checklist with JSON export. No credentials or remote-write endpoint exist in the web page.

For private phone access on this machine, use an unused Tailscale HTTPS port. The current experiment uses port 8493, without changing existing Serve/Funnel routes:

```sh
CODA_ALLOWED_HOSTS=penguin.tail813aca.ts.net npm start
# In another terminal:
tailscale serve --bg --https=8493 http://127.0.0.1:8493
```

Both devices must have access to this tailnet. Keep the host awake. Stop only this experiment's HTTPS route with `tailscale serve --https=8493 off`; do not reset the shared Serve configuration. If your hostname differs, replace it in `CODA_ALLOWED_HOSTS`.

## Automated checks

```sh
npm test
python3 -m unittest discover -s tests -p '*_test.py'
npx playwright install chromium
npm run test:browser
```

The browser check runs real generated audio, seeking and transitions, queue changes, export, and screenshots at 390px and 728px. It does not prove physical Android background behavior or Zen behavior. When using an existing compatible Chromium binary, set `CHROMIUM_PATH` to its absolute path. Browser screenshots and exports go into ignored `artifacts/`.

## Public service experiments

YouTube.js (read-only, no account):

```sh
npm run probe --silent
```

Python comparison:

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/music_probe.py
```

Use a temporary directory under your home for large installs on this machine; `/tmp` is small. Both probes use the same three search cases and public playlist from `scripts/cases.json`. These commands make real upstream requests and may fail after service changes. No fake data replaces failures. The basic player probe deliberately disables JS player retrieval and does not resolve or stream media: a failure only establishes that this basic approach is insufficient, not that Coda playback is impossible.

## Actual audio sample probe

With development dependencies and Chromium installed, run:

```sh
npm run probe:playback --silent
```

Set `CHROMIUM_PATH` when using an existing compatible Chromium binary. This separate command makes real anonymous requests for the three fixed playback IDs in `scripts/cases.json`, resolves SABR streaming with YouTube.js and googlevideo, retains up to four chunks / 1 MiB per track, then clicks Play and verifies that actual audio advances more than one second in Chromium. Each track's request/decode phase has a 45-second deadline after browser-page setup; requests have 15-second deadlines. Upstream buffering may transfer more bytes than the retained sample. Audio stays in memory and is discarded when each fresh browser context closes. JSON output contains counts and results, with library logs and upstream exception messages suppressed to keep signed URLs and session data out of reports. A failed check exits nonzero.

Extracted player JavaScript runs only in a fresh offline browser context; it is not evaluated in Node or the private web server. The browser has no saved profile or account session. No token minter is implemented. A sample PASS establishes anonymous media retrieval and short decoding on this machine; it does not establish full-song playback, seeking, phone background behavior, Premium behavior, or Coda's integrated queue. The optional prepared-music mode below uses complete files rather than this short sample probe.

## Account experiment (owner setup required)

Do not send passwords, cookies, browser exports, or auth files through chat or commit them. On your own machine, follow [ytmusicapi browser authentication](https://ytmusicapi.readthedocs.io/en/stable/setup/browser.html) to create a browser-auth file **outside this checkout**, for example `~/.config/coda/browser.json`. Restrict its permissions with `chmod 600 ~/.config/coda/browser.json`. This experiment expects browser authentication, not OAuth credentials.

First run account reads only:

```sh
.venv/bin/python scripts/music_probe.py --auth "$HOME/.config/coda/browser.json"
```

Then, when ready to create a disposable playlist:

```sh
.venv/bin/python scripts/music_probe.py --auth "$HOME/.config/coda/browser.json" --write-test
```

The write test creates one new private `Coda experiment <timestamp>` playlist, adds a duplicate, moves it, removes that exact duplicate, and verifies private visibility and item order after each step, including which duplicate survives removal. It never edits an existing playlist and never retries writes. It leaves the test playlist for you to inspect in YouTube Music. If a request fails or times out, inspect any reported `playlistId` before running again; every run creates a new playlist. The output contains sanitized IDs/order, not session data. Actual account tests remain blocked until a local session is configured.

## Phone and Zen checks

Open the private page. Fill in device/OS/browser version. Play the tone queue and check the controls, seeking, transitions, and switching panels. On Chrome/Android, keep the queue looping for ten minutes with the screen locked; try lock-screen/headset controls, another app, an interruption, and battery saver. Mark each result and export JSON **before reloading**. Results are not saved automatically. Generated tones establish browser behavior only. Repeat with real YouTube audio after playback integration is implemented.

The web page provides no PWA installation/offline app, live media proxy, arbitrary YouTube playback, token generation, or Premium account behavior. It can optionally play the three locally prepared complete files described below. The separate sample probe demonstrates limited SABR URL resolution and compressed-audio decoding.


## Android next-track stall comparison

The original phone export showed three long waits while the next tone was loading. The page now offers **Load all three tones before playing** before the first Play. Wait for **Ready**, then play and lock the phone under the same battery/network conditions for at least five minutes. Export immediately on returning. Reload to return to the original network mode; export first because reloading clears observations. This mode loads only the three generated test files into memory and does not promise reliable background playback or offline YouTube access.

Version 2 exports label the chosen delivery mode and whether the last-300-event history was truncated. Button and media-key actions are logged where exposed, without attempting to guess every OS interruption reason. The browser test additionally disables networking after preparation and verifies three real track transitions; a simulated partial load failure keeps the original network mode usable.


## Private prepared-music mode

Use an empty directory outside the checkout for the three fixed complete test tracks:

```sh
export CODA_MUSIC_DIR="$HOME/.cache/coda/music-test-20261024"
npm run prepare:music --silent > artifacts/prepared-music.json
npm start
```

Install development dependencies and Chromium first; set `CHROMIUM_PATH` when needed. Preparation uses the YouTube Music client and browser-based attestation. It retrieves complete WebM/Opus files anonymously, enforces the advertised byte count and a 16 MiB maximum per track, checks decoding at the start/middle/end, then writes the manifest only after all three pass. The whole preparation has a three-minute deadline after browser launch, with 15-second request deadlines. Files are 0600 and the newly created directory is 0700. No audio, cookies, signed URLs or generated tokens are committed. Failed preparation leaves no published manifest; inspect the report and use a new empty directory for another attempt. The server never creates or refreshes this cache.

Start the server with the same `CODA_MUSIC_DIR`. Only the three fixed tracks are readable; each media request checks its length and SHA-256 before serving bytes or a range. Without that environment setting, music mode returns unavailable and tones remain usable. The server needs no Chromium or token minter at runtime.

On the page, choose **Load three prepared music tracks**, wait for **Ready**, then tap Play. It loads about 16 MB into browser memory first, keeps the existing queue and controls, and labels exports with the real source, track IDs and preparation time. A partial load failure returns to tones. Choose before first playback; export and reload to change modes. This tests fully buffered real music, not ongoing SABR streaming or arbitrary catalog playback. No Premium session is connected.

Run the integration checks against your prepared cache:

```sh
npm run test:music
# Also wait through the first song at normal speed:
CODA_LONG_PLAY=1 npm run test:music
```

The optional longer check takes about six minutes. On phone Chrome, reload the private page, select music, wait for Ready, press Play, then lock for ten minutes and export immediately after returning. Note silence, missing notification controls or any need to reopen the page. Ten minutes crosses the first natural transition; all three natural transitions take about sixteen minutes. Keep other checklist items NOT RUN unless you tested them. Prepared-file success does not establish live-stream renewal, Premium behavior or authenticated playlist writes.
