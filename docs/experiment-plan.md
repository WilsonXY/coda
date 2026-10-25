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

Result, 24 October 2026 MYT: the real-music phone export retains all 34 events, with 904.166 seconds hidden and two natural song transitions (0.104 / 0.080 seconds between ended and playing events). The owner confirms the screen stayed locked, music remained audible throughout, and notification/lock-screen controls stayed available. Record PASS for this one prepared-music run and controls availability; keep the untouched exported checklist as-is. See [phone evidence](evidence/android-chrome-music-2026-10-24.json). Controls interaction, headset behavior and interruption recovery remain separate checks; next exercise another app's video interruption and explicit resume from the previous position. No new app functionality is needed to run those checks. Live streaming, Zen and account operations remain unverified.

Interruption result, 24 October 2026 MYT: manual resume and position preservation pass for one prepared-music phone run. The owner reports no automatic resume; the log shows pause, return and manual resume all at 20.79 seconds, with playing 0.039 seconds after the explicit Play tap. No errors/stalls/play rejection were recorded. See [interruption evidence](evidence/android-chrome-interruption-2026-10-24.json). Keep automatic resumption separate from manual recovery, and keep exported NOT RUN defaults intact. The next target-device check is Zen playback, seeking, next/previous and queue changes. Incremental/live delivery and account/playlist operations remain independent investigations; no additional phone playback code is needed for the measured manual-resume behavior.

Desktop result, 24 October 2026 MYT: the new Firefox-family Linux export records prepared-music playback for all three tracks, completed seeks, ten Next/one Previous actions, two reorders and one removal, with no retained errors/stalls/play rejection. The owner explicitly confirms Zen on PC and that playback, seeking, queue reordering and removal worked; record PASS for those actions in this run, separately from exported NOT RUN defaults. Five initial events are truncated. Eight prompt automatic advances follow endings during a short seek-heavy run; one queue-end requires explicit Play, so its wait is not an automatic-transition failure. See [desktop evidence](evidence/desktop-music-2026-10-24.json). Keep untouched NOT RUN defaults and avoid full-song or exact queue-state claims from this log alone. Target-browser confirmation is complete for these prepared-music actions. Move to incremental/live delivery and the separately blocked local-account experiment.

## Progressive delivery: next phone test

The opt-in live experiment now passes a fresh three-song desktop Chromium check: each starts before upstream EOF, completes with expected bytes/hash, supports middle seeking and end-induced transitions. See [results](experiment-results.md) and [upstream evidence](evidence/live-music-upstream.json). It downloads each selected song into a bounded shared server buffer rather than loading all songs into browser memory before Play. Start a fresh server run so the first and second tracks are cold; exports include its run ID and preexisting retrieval IDs. On Android Chrome select **Use live music**, Play, lock for ten minutes and export immediately on return. Report audible gaps, notification controls and any need to reopen or tap Play. Do not mark full background/live playback PASS until this device evidence arrives. Seeking beyond received bytes may wait; renewal, arbitrary songs and account/playlist integration remain separate investigations.

Android live-mode result, 24 October 2026 MYT: **FAIL**, two hidden automatic transitions stalled until reopening the phone, with 45.387/69.564-second event gaps. Selection began cold, but foreground visits had already retrieved all three songs before locking; the stalled transitions used warm server captures. See [failed-run evidence](evidence/android-chrome-live-2026-10-24.json). Do not count this as a successful cold next-track test or overwrite it with a later workaround. Before changing playback, use bounded per-HTTP server timings to separate request deferral, transport and response handling. Focused rerun: fresh service run, phone Chrome, live mode, first song only, lock for seven minutes without skipping, then return/export. If the next song waits, leave it for roughly ten seconds before returning. No fix is claimed yet; the already passing prepared mode remains available.

Diagnostic result, 24 October 2026 MYT: the warm first transition took 0.234 seconds, while the cold third-song transition stalled for 70.384 seconds. Its request had already reached the server; upstream retrieval completed in 1.530 seconds, but the original HTTP response did not finish and a replacement succeeded around recovery. See [diagnostic evidence](evidence/android-chrome-live-diagnostic-2026-10-24.json). The owner confirms battery operation with power saving on. Next change only Battery Saver to off; keep the phone unplugged and Chrome/Tailscale/network conditions unchanged. Start from a fresh empty live run, play the first song only and let it advance while locked for seven minutes, then export and record the power condition. This is a hypothesis test; it does not yet establish the cause or a fix. Android Doze remains a separate possible condition.

Short comparison, 24 October 2026 MYT: owner reports success; two hidden warm-server transitions took 0.080/0.121 seconds, in 40.620/109.722-second hidden intervals. See [short-run evidence](evidence/android-chrome-live-short-2026-10-24.json). The requested condition was Battery Saver off/unplugged, not measured by the export or independently confirmed. Selection began cold, but all three captures completed before locking; 448 initial events are truncated. Cache state and lock duration differ from the prior failure, so do not label this a causal Battery Saver result or a permanent requirement to keep it off. Supersede the repeated seven-minute instruction above with short transition checks using seeks near the end; retain prolonged locking only for final inactivity confirmation. Next candidate: buffer upcoming audio in the browser and test with Battery Saver on. This is not implemented or proven; server warming alone previously failed, and the prepared-Blob success had no established power setting. No additional owner test is requested before that candidate is ready.

## Implemented next-song browser buffering

After PR #9, the next experiment keeps immediate progressive startup and optionally buffers the upcoming song in the browser. Choose the new checkbox in live mode before Play, then wait for next-song readiness before locking. This is a separate candidate from merely warming the server. Keep the earlier failed runs and qualified short success as evidence; no Battery Saver fix is yet established. The browser retains at most current/next entries and releases obsolete downloads/Blob URLs on queue changes/reset. A not-ready/failed entry uses the original live route, with that choice recorded in persistent export state.

Desktop fixture verification covers a gated progressive first song followed by a Blob-backed transition/seek with networking disabled, failure fallback, queue mutation cleanup and export truncation. Next owner check: Battery Saver on and unplugged, first song only, wait for next-song readiness, seek near its last thirty seconds and lock ninety seconds. Export actual settings and audible/recovery observations. Only a passing short test warrants a longer locked confirmation. Account/playlist work and general source renewal remain separate.

Short buffering result, 24 October 2026 MYT: the owner reports repeated success. One retained hidden loop transition uses a ready phone Blob and starts after 0.121 seconds; the following song completes a browser download in 0.835 seconds while still hidden. See [phone evidence](evidence/android-chrome-next-song-buffer-2026-10-24.json). The retained hidden interval is 60.146 seconds and 465 earlier events are truncated. Exact Battery Saver/unplugged/physical-lock/listening conditions await explicit confirmation; all checklist defaults remain NOT RUN. Keep this short technical pass separate from a power-setting confirmation or sustained playback result. No additional short repeats or app changes are warranted; after conditions are established, one prolonged locked confirmation remains.

Owner follow-up resolves the short-run condition question: Battery Saver was on, the phone unplugged, the screen locked, and the next song remained audible without waking (answer: “Yes, all of those”). Record the short buffered locked-screen run PASS with those owner-confirmed conditions; the export itself does not measure them. No more short repeats are needed. One prolonged locked confirmation remains before a sustained-reliability claim, while earlier failures and unresolved causality stay documented.
