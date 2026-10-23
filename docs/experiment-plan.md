# Coda experiment: prove the basics before designing the app

Target: Zen on PC and Chrome on Android. The owner has YouTube Music Premium. A Premium subscription is recorded as a test condition, not assumed to make every unofficial client work.

## What we want to learn

Can one privately hosted website search YouTube Music, manage the owner's playlists, and keep playing reliably on both devices? An attractive interface is outside this experiment. Use plain controls and record actual results.

## Test order and success criteria

### 1. Ordinary browser playback

Use three generated test tones, with no YouTube dependency. Start playback with an explicit click/tap. Keep the same player alive while switching between the Player and Search panels.

On **both devices**, check play/pause, seeking, volume, previous/next, queue order, and automatic transitions. On **Chrome/Android**, additionally lock the screen for ten minutes with queue looping, use headset/lock-screen controls, switch apps, receive an interruption, and return. Repeat with battery saver enabled and record the difference. Zen must also be checked by the owner; automated Firefox is supporting evidence, not a Zen test.

**Pass:** controls behave as expected; panel navigation does not restart audio; the queue continues through at least three transitions. The ten-minute phone test has no unexplained interruption. A browser killed by the OS is a distinct observation, not evidence that the service integration failed.

**Evidence:** event log with timestamps, browser/OS, test notes, and an exported result file. Generated tones test browser behavior, not real music quality or compressed audio support. Start quietly.

### 2. Public YouTube Music access

Use the same query through YouTube.js and ytmusicapi. Record versions, latency, top IDs/titles, and errors. Read a public playlist and record how many items and whether additional pages exist. Test an ordinary query, a misspelling, and a query with non-Latin text. Both automated probes read the same three queries and public playlist ID from `scripts/cases.json`, so their committed snapshots can be compared.

**Pass:** real song results and a real public playlist can be read. Results have stable IDs usable by the next experiment. Report pagination separately; one page does not prove complete long-playlist support.

**Evidence:** sanitized JSON probe output. Never treat an empty response or parser error as a successful search.

### 3. Account access and playlist changes

Requires the owner to supply a session locally, outside the repository. Never paste credentials into chat. Use the library's documented setup. Keep authentication files private and out of logs. An existing YouTube browser login does not automatically sign Coda in.

Read a private playlist/library first. Then run the account experiment, which creates one **new private disposable playlist** named `Coda experiment <timestamp>`. Make changes only to the ID returned by that creation. No existing playlist is edited. Leave the test playlist for inspection; the owner may delete it afterward.

Use tracks A and B: create [A, B], add a duplicate A → [A, B, A], move the duplicate to the front → [A, A, B], remove that exact occurrence → [A, B]. Read back after each operation, confirming PRIVATE visibility and using playlist-item identifiers to distinguish duplicates and verify that the original copy survives removal. Verify the final playlist in the official service. Do not automatically retry writes: a timeout may have occurred after the server applied the change. An immediate readback may also lag behind a successful write; a mismatch stops the test and requires inspection before another run.

**Pass:** account reads succeed; all four readbacks match; the official website shows the final two tracks. Separately record session expiry, reauthentication, and logout. These recovery cases may need a later session; a one-off successful write does not prove them.

**Evidence:** playlist ID, item order before/after each action, and owner verification. Do not include raw upstream responses, cookies, or auth headers.

### 4. YouTube playback feasibility

First inspect real player responses without pretending that a status of `OK` means audio played. Record playability, audio-format count, and whether usable direct URLs or a different streaming delivery mechanism are provided. Never export signed media URLs.

If the basic URL approach fails, record that result and investigate the library's current playback examples. Do not build a new streaming protocol implementation as part of the UI experiment. Preserve the distinction between “catalog works,” “player reports playable,” “media bytes arrive,” and “the browser actually plays.”

**Pass:** selected YouTube tracks actually play and seek in both target browsers. Repeat the queue and ten-minute Android checks from step 1, plus network changes and obtaining a fresh media source after restart. Test Premium-specific behavior only with the owner's authenticated session. A silent/basic player-response probe cannot pass this stage.

**Evidence:** browser events, actual media duration/progress, seek result, interruption notes, and sanitized errors. If audio delivery needs a proxy, measure its bandwidth and seek/range behavior before adopting it.

### 5. Decide whether to proceed

Proceed to UI/UX only when required browser playback, playlist operations, and integrated playback pass. Record unsupported features and maintenance costs. Failure can mean a different playback library, a reduced requirement, or a different platform; it is useful evidence.

No offline YouTube downloads, live device handoff, casting, Android Auto, public hosting, transcoding, plugin framework, or production authentication system is included here.

## What can run without the owner

Automated tests for the harness, desktop browser playback using generated tones, public search/playlist reads, a basic playability probe, and a comparison of the two libraries. These do not establish Android/Zen behavior or account compatibility.

## What needs the owner

Open the private test URL on the phone and in Zen, run the device checklist, export the result files, and configure an account session locally for the private-playlist experiment. No account experiments run until a local session is available. No claim of a complete working YouTube player until real audio has played.

## Record each result

Use `PASS`, `FAIL`, `BLOCKED` (missing account/device/access), or `NOT RUN`. Include date, versions, device/browser, request or action, expected behavior, observed behavior, and supporting logs. Keep failures as failures rather than replacing them with fallback sample data.

## Sources

- [YouTube.js browser integration and current example warning](https://ytjs.dev/guide/browser-usage)
- [YouTube.js authentication](https://ytjs.dev/guide/authentication)
- [ytmusicapi playlist operations and playlist-item IDs](https://ytmusicapi.readthedocs.io/en/stable/reference/playlists.html)
- [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)
- [Chrome autoplay rules](https://developer.chrome.com/blog/autoplay/)

The broader findings and terms/licensing considerations remain in [investigation.md](investigation.md).


## Next controlled phone test: remove network fetches between tones

The original Android Chrome export shows delayed next-track loads during locked/background playback. Before repeating a full run, compare the existing network mode with a mode that loads all three test tones into memory before playback. Choose the mode before first playback; export and reload before switching. Keep phone, connection, loop setting, and battery policy the same. Run the preloaded comparison for at least five locked-screen minutes, then export from phone Chrome. Record stops, notification controls, resumption position, and whether opening the page was needed. This isolates transition-time media fetching as a variable; it is not a claimed fix for Android power management or YouTube streaming.

Result, 23 October 2026: the owner reports the preloaded comparison worked throughout ten minutes. The export retains 37 prompt transitions (median 0.092 s, max 0.117 s) with no stalled/error/play-rejected events, but truncates the initial history. See [results](experiment-results.md) and [derived evidence](evidence/android-chrome-preloaded-2026-10-23.json). Record a PASS for this one reported run; controls, interruption recovery, repeatability, and actual YouTube playback remain separate checks.


## Actual audio sample result and next step

A standalone three-track SABR sample probe now passes anonymous retrieval and over one second of real decoding per track in desktop Chromium. Run `npm run probe:playback --silent`; the fixed playback IDs share `scripts/cases.json`. See [recorded results](experiment-results.md) and [sample evidence](evidence/youtube-playback.json). This is a short media-source test, not integrated playback: full songs, seeking, queue transitions, protection-token behavior and physical-device playback remain to be demonstrated. Integrate the proven source into the private player only with those limits visible, then repeat the device checks with real audio.


## Prepared real music: device test

Complete Music-client retrieval and targeted decoding now pass for the three fixed tracks. The private player can load these verified local files into browser memory before playback. See [results](experiment-results.md) and README for preparation/server commands. This isolates real-file decoding and queue behavior from live SABR fetching. Once the private page is configured, repeat the ten-minute Android Chrome lock-screen test with this source and export immediately; inspect source/IDs and distinguish owner observations from untouched checklist defaults. Test seeking and three induced transitions separately, or wait about sixteen minutes for all three natural transitions. Live streaming, source refresh, Premium/account behavior and authenticated playlist operations remain separate investigations.
