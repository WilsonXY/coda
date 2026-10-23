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

No PWA installation/offline support, media proxy, compressed-audio decoding, signed-URL resolution, token generation, or Premium playback behavior is claimed by this harness.


## Android next-track stall comparison

The original phone export showed three long waits while the next tone was loading. The page now offers **Load all three tones before playing** before the first Play. Wait for **Ready**, then play and lock the phone under the same battery/network conditions for at least five minutes. Export immediately on returning. Reload to return to the original network mode; export first because reloading clears observations. This mode loads only the three generated test files into memory and does not promise reliable background playback or offline YouTube access.

Version 2 exports label the chosen delivery mode and whether the last-300-event history was truncated. Button and media-key actions are logged where exposed, without attempting to guess every OS interruption reason. The browser test additionally disables networking after preparation and verifies three real track transitions; a simulated partial load failure keeps the original network mode usable.
