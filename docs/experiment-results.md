# Coda experiment results

Recorded 23 October 2026. Targets: Zen/PC and Chrome/Android. Owner reports YouTube Music Premium. All upstream tests below were unauthenticated. No account session was used and no remote playlist was changed.

## Results so far

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Plain browser player | PASS in automated desktop Chromium | Actual generated WAV playback, play/pause, seek, three automatic transitions, queue loop, reorder/remove/reset, and uninterrupted playback across panels. This is not a Zen or physical Android test. |
| Small-screen page | PASS at 390px and 728px | Browser interaction and screenshots in ignored `artifacts/`; no horizontal page overflow. |
| JSON device export | PASS | Downloaded JSON contains events and leaves all manual checks as NOT RUN. |
| Public search / YouTube.js 18.3.0 | PASS | Fixed query returned 20 songs, including `4D7u5KF7SP8`. First measured query took 708 ms, including session initialization. |
| Public search / ytmusicapi 1.12.3 | PASS | Same query returned the same leading song ID. Entire Python public probe, including all three search cases and the playlist read, took 2.475 seconds. These timings cover different work and are not a benchmark. |
| Misspelling | PASS in both libraries | `Daft Pnk Get Luky` returned `4D7u5KF7SP8` first. |
| Non-Latin query | PASS in both libraries | `周杰倫` returned `t0AvpJ74sBc` first. This proves these sample requests, not general search quality. |
| Same public playlist | PASS in both libraries | `PLKnoch_ESAUI`, titled Daft Punk: both read 53 items; YouTube.js reported no further page. ytmusicapi can return an entire page exceeding its requested limit. Long-playlist continuation remains NOT RUN. |
| Basic player response / WEB | FAIL for this approach | `UNPLAYABLE`, reason `Video unavailable`, zero audio formats. Probe deliberately disabled JS player retrieval. This does not establish that a properly integrated WEB player cannot work. |
| Basic player response / ANDROID | Response received; playback NOT RUN | `OK`, six audio formats, zero direct audio URLs, SABR URL present. No audio bytes were fetched or played. |
| Authenticated library and playlist operations | BLOCKED | Needs owner-provided local browser-auth file. The separate script is ready; its write safety and duplicate handling have automated tests, not live account proof. |
| Actual YouTube audio in Coda | NOT RUN | No stream resolver, SABR delivery, or browser media integration is implemented. Must investigate current library playback examples before claiming this works. |
| Premium behavior | NOT RUN | Public tests cannot establish subscription behavior. |
| Chrome/Android: original network mode | FAIL sustained screen-lock playback; basic playback works | New phone export records 38 ended-to-playing intervals with three long gaps (12.823 s, 12.816 s, 145.666 s). Owner marks ten-minute lock-screen FAIL and reports controls disappear; reopening resumes from the same position. Other checklist items are owner-marked PASS, with battery/background reliability qualified by these notes. |
| Chrome/Android: preloaded tones | PASS ten-minute run, owner-reported | Latest export labels preloaded mode. Its retained 12 min 40.560 s contain 37 ended-to-playing intervals, median 0.092 s, maximum 0.117 s, with no retained stalled/error/play-rejected events. Manual checklist was left NOT RUN; the owner confirmed ten minutes worked in chat. Controls, interruptions, and battery settings are not established by this run. |
| Zen/PC | Basic playback captured; full checklist attribution incomplete | The earlier desktop export recorded two track transitions and mixed phone observations. It does not establish a complete per-device result. |

Both probes now use the shared cases in `scripts/cases.json`; every public-search row above is represented in the snapshots. Raw sanitized public probe snapshots: [YouTube.js](evidence/youtubejs.json), [ytmusicapi](evidence/ytmusicapi.json). These contain no credentials or signed media URLs. A PASS on the JSON player-response request only means the request completed; `playbackTested` remains false.

## Automated verification

- `npm test`: three server tests pass: explicit public-file serving, audio range/seek support, and method/origin/input rejection before upstream requests.
- `python3 -m unittest discover -s tests -p '*_test.py'`: nine account-flow and authentication-file safety tests pass against a fake service, not a real account.
- The same Python tests pass with `python3 -O`; stopping conditions remain active when Python assertions are disabled.
- `npm run test:browser`, with `CHROMIUM_PATH` pointing to installed compatible Chromium: passed real generated-audio interaction and JSON export.
- Node syntax checks and `git diff --check`: pass.
- `npm audit --omit=dev --audit-level=high`: no production vulnerabilities reported at test time.

T3 preview could not start: `This host blocks the sandbox T3's browser runs in (AppArmor on Ubuntu 23.10+).` A standalone Playwright runner using an existing headless Chromium with `--no-sandbox` was used for local browser verification. No host sandbox settings were changed.

The Python public probe initially failed because this ytmusicapi version has no `requests_timeout` constructor parameter. The invocation was corrected to use its documented constructor and built-in timeout; the rerun passed. This failure was in the harness, not evidence of an upstream outage.

## Conclusion for the next test

The browser harness and public data access work on this machine. Full Coda feasibility remains undecided until real YouTube audio delivery, authenticated playlist changes, and target-device behavior are demonstrated. Use the [experiment plan](experiment-plan.md) for the remaining steps and README for commands.

## Review and delivery

Claude Opus 5.5 reviewed the first commit at high effort. Its own session log confirmed both settings; the parent independently checked those log fields. The first verdict was FAIL because the saved snapshots did not support the shared-playlist row. The code, snapshots, and safeguards were corrected as recorded below. A fresh second review of commit `1fc6984` returned PASS with no blocking security, account-safety, or logic findings.

Review dispositions:

1. **Fix (medium):** both probes now use one fixed public playlist ID and fresh matching snapshots, rather than selecting separate search results.
2. **Fix (medium):** the misspelling and Chinese query are now reproducible shared cases, with committed output from both libraries.
3. **Fix (low):** readbacks require PRIVATE visibility before another mutation.
4. **Fix (low):** final verification checks that the original playlist-item ID survives removal of the duplicate.
5. **Fix (low):** both IDs must be distinct ASCII 11-character IDs before creating a playlist.
6. **Fix (low):** fake-service checks no longer use removable Python assertions; added tests for missing auth, repository-local auth, and file permissions. All nine Python tests pass normally and under `-O`.
7. **Fix (low):** the plan and error note explain possible readback propagation delay and require inspecting the scratch playlist before another run; writes remain unretried.
8. **Fix (low):** malformed/null origins get an explicit 403; generic failures no longer claim every error came from upstream.
9. **Fix (low):** removed the hardcoded Premium field from generated-tone exports; a browser regression check verifies its absence.
10. **Fix (style):** renamed the player-client loop variable to avoid hiding the session function.
11. **Decline (optional preference):** kept server-delivered tones and byte-range support because this experiment deliberately tests HTTP media delivery and seeking. Browser Blob audio would omit that delivery path. The existing implementation is small and tested.

First reviewer log: `~/.claude/projects/-home-penguin--t3-worktrees-coda-t3-8e271002/8c2ade02-a43a-47e5-88f4-92b94c26b5e7.jsonl` (`model: claude-opus-5-5`, `effort: high`, `perTurnEffort: high`). Parent and review worktree retained their starting commit and clean status; no reviewer mutation commands were present. T3 renamed its temporary branch during setup; the worktree and branch were removed after validation. The checkout initially had no GitHub remote. The owner later supplied `WilsonXY/coda`; its README and MIT license were preserved while joining the histories on the feature branch. [PR #1](https://github.com/WilsonXY/coda/pull/1) was opened from `luna-agent1/coda` because the signed-in account has read-only access to the base repository. GitHub reports no CI checks; local checks are recorded above and no hosted CI pass is claimed. Screenshot attachment was rejected for lack of base-repository write access. Current screenshots remain in ignored `artifacts/player-390.png` and `artifacts/player-728.png` for the owner to attach; they are not presented as remotely uploaded proof.


Second reviewer log: `~/.claude/projects/-home-penguin--t3-worktrees-coda-t3-e76a7d52/b155a024-69f8-46ef-9ec2-ede57ebe0fab.jsonl`. Both the reviewer and parent confirmed `model: claude-opus-5-5`, `effort: high`, and `perTurnEffort: high`; no fallback was used. Parent and reviewer worktree HEAD/status stayed unchanged, reviewer commands contained no mutations, and the temporary worktree/branch were removed.

Second-round non-blocking findings:

1. **Resolved (low):** the parent confirmed ytmusicapi 1.12.3's installed `ytmusic.py` describes the default 30-second request timeout at line 76 and sets `partial(self._session.request, timeout=30)` at line 233. The existing timeout statement is supported by the installed source.
2. **Fix (low):** tightened the repository-local auth-file test by simulating private 0600 permissions, so file permissions cannot conceal a missing repository-boundary check. All nine Python tests pass normally and under `-O`. A separate process deliberately disabled the boundary check in memory; the tightened test failed as expected. No production code was changed for that check.
3. **Fix (info):** this record now reports the second review's PASS rather than pending.
4. **Decline (style preference):** the checklist's block-scoped `select` DOM variable does not affect the outer track-selection function. No functional problem was identified, so the verified browser code was retained.

The final follow-up changes only this record and the tighter test; production code is unchanged from the passing review. The review itself added no real account or phone results. Separately, the owner then reported the basic Chrome/Android screen-lock result recorded above. The private test page remains running for the remaining device checks.


Owner device observation (23 October 2026): “Tones play and continue with screen locked.” This establishes basic generated-audio behavior in phone Chrome only; it does not establish a ten-minute run, automatic queue transitions, Zen behavior, or YouTube audio playback. No exported device log was provided with this observation.


## Android Chrome follow-up and preload comparison

The owner supplied a phone export dated 23 October 2026 at 14:18:40 UTC. Its retained 300 events span 20 minutes 2.037 seconds. The old harness caps history at 300, so this window is not asserted to be the full run. The checklist marks nine items PASS and ten-minute Android screen lock FAIL. Notes report disappearing media controls after YouTube playback or several locked-screen minutes, with audio continuing from its stopped position on returning to Coda. A derived summary with source hash is saved in [the phone evidence](evidence/android-chrome-2026-10-23.json).

Across 38 retained ended-to-playing event intervals, the median is 0.1645 seconds. Three intervals are much longer:

- 14:08:37.135 → 14:08:49.958 UTC: 12.823 seconds, Tone A → B.
- 14:11:54.272 → 14:12:07.088 UTC: 12.816 seconds, Tone A → B.
- 14:14:30.962 → 14:16:56.628 UTC: 145.666 seconds, Tone B → C.

Each long interval contains `waiting`/`stalled` for the next tone at position zero before `loadedmetadata` and `playing`. These timings describe dispatched events, not directly measured audible silence. They locate a delay during the next media load; they do not distinguish browser scheduling, power management, VPN/network behavior, or another cause. Server service state retained the same PID and activation time throughout this window, with no additional restart or journal entry; that excludes an observed app-process restart, not every possible network failure.

The earlier 502 outage was separately restored by running the private server as a user-managed background service. The service's automatic restart was tested before this phone run; no source-code deployment system is introduced here.

A controlled comparison is now available: before first playback, load all three generated WAV files into memory. The same media element, queue, tone bytes, and controls are retained, while track transitions use Blob URLs rather than requesting the next tone over the network. Failed or timed-out preparation leaves network mode selected; changing mode after playback requires exporting and reloading, so a report describes one chosen delivery mode. The comparison does not implement real YouTube playback, a full offline app, or guaranteed background operation.

Exports now identify schema version 2, delivery mode, total event count and whether history was truncated. Custom button and media-action events, plus available load/lifecycle events, improve attribution; native/browser/OS actions still may not reveal why playback paused. The harness does not force automatic resumption after another app finishes.

Automated Chromium checks passed original playback, successful three-file preparation, three transitions with browser networking disabled, mode/export labels, and recovery to the original mode when one preparation request returns 503. Screenshots at 390px/728px were captured locally. At the initial code review, physical Android results for this comparison were NOT RUN; the later phone run is recorded below. Independent Astra review: PASS, no blocking findings; prior Claude reviews above apply to the original harness. The reviewer independently verified the attachment hash and all reported timing calculations. Actual model `gpt-6-astra` and effort `high` were confirmed in its Codex session log `rollout-2026-10-23T22-35-26-01a16930-27af-7af2-8ea0-80e2c9cdd035.jsonl`, turn-context line 8. Parent HEAD/status/origin branch refs and reviewer HEAD/status remained unchanged; the clean review worktree and branch were removed afterward. Optional suggestion: add a stalled-request timeout followed by retry test. Deferred additional coverage: no defect was identified, HTTP-error recovery is covered, and timeout/retry remains explicitly unverified.

### Phone comparison result

The next export, dated 23 October 2026 at 15:09:21.958 UTC, confirms `audioDelivery: preloaded`. The owner then reported: “now it seems work throughout the whole 10 mins”. Record this as a PASS for the reported ten-minute generated-tone screen-lock run, supported by the retained transitions. The JSON checklist itself remains entirely NOT RUN, with empty notes/device description; the chat confirmation establishes this one reported result, not the other checklist items.

Of 375 total events, only the final 300 remain, spanning 14:56:38.140–15:09:18.700 UTC (12 minutes 40.560 seconds). The 37 retained ended-to-playing intervals have median 0.092 seconds and maximum 0.117 seconds; none resemble the original 12.8/145.7-second stalls. No `stalled`, `error`, or `play-rejected` event is retained. All retained events label preloaded mode. These are event timings rather than measured audible silence. The screen-hidden onset and preparation are no longer retained, so exact locked duration comes from the owner. A final pause at 5.82 seconds has no retained control attribution; its cause is unknown and is not assigned as a failure or a manual pause.

The [derived preloaded-phone summary](evidence/android-chrome-preloaded-2026-10-23.json) includes the source hash, original checklist state, owner follow-up, counts, and limits. This comparison supports investigating transition-time fetching as a contributor to the earlier failures. It does not prove the exact cause, repeatability, unchanged battery conditions, notification-control persistence, interruption recovery, or YouTube streaming reliability.

The ten-minute comparison is complete for this run. Remaining targeted checks include notification controls and interruption/resumption in preloaded mode, plus actual YouTube delivery and authenticated playlist operations. Repeat background checks after real-music integration; preloading all music is not a proposed application design.
