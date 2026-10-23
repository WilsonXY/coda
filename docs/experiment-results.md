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
| Zen and physical Chrome/Android | NOT RUN | Owner must perform device checklist, including ten minutes with screen locked. |

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

First reviewer log: `~/.claude/projects/-home-penguin--t3-worktrees-coda-t3-8e271002/8c2ade02-a43a-47e5-88f4-92b94c26b5e7.jsonl` (`model: claude-opus-5-5`, `effort: high`, `perTurnEffort: high`). Parent and review worktree retained their starting commit and clean status; no reviewer mutation commands were present. T3 renamed its temporary branch during setup; the worktree and branch were removed after validation. This checkout has no GitHub remote, so pushing, opening a PR, and checking hosted CI require a repository destination. Local checks are recorded above; no hosted CI result is claimed.


Second reviewer log: `~/.claude/projects/-home-penguin--t3-worktrees-coda-t3-e76a7d52/b155a024-69f8-46ef-9ec2-ede57ebe0fab.jsonl`. Both the reviewer and parent confirmed `model: claude-opus-5-5`, `effort: high`, and `perTurnEffort: high`; no fallback was used. Parent and reviewer worktree HEAD/status stayed unchanged, reviewer commands contained no mutations, and the temporary worktree/branch were removed.

Second-round non-blocking findings:

1. **Resolved (low):** the parent confirmed ytmusicapi 1.12.3's installed `ytmusic.py` describes the default 30-second request timeout at line 76 and sets `partial(self._session.request, timeout=30)` at line 233. The existing timeout statement is supported by the installed source.
2. **Fix (low):** tightened the repository-local auth-file test by simulating private 0600 permissions, so file permissions cannot conceal a missing repository-boundary check. All nine Python tests pass normally and under `-O`. A separate process deliberately disabled the boundary check in memory; the tightened test failed as expected. No production code was changed for that check.
3. **Fix (info):** this record now reports the second review's PASS rather than pending.
4. **Decline (style preference):** the checklist's block-scoped `select` DOM variable does not affect the outer track-selection function. No functional problem was identified, so the verified browser code was retained.

The final follow-up changes only this record and the tighter test; production code is unchanged from the passing review. No real account or phone results were added. The private test page remains running for the owner's device checks.
