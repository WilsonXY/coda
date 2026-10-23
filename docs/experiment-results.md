# Coda experiment results

Recorded 23 October 2026. Targets: Zen/PC and Chrome/Android. Owner reports YouTube Music Premium. All upstream tests below were unauthenticated. No account session was used and no remote playlist was changed.

## Results so far

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Plain browser player | PASS in automated desktop Chromium | Actual generated WAV playback, play/pause, seek, three automatic transitions, queue loop, reorder/remove/reset, and uninterrupted playback across panels. This is not a Zen or physical Android test. |
| Small-screen page | PASS at 390px and 728px | Browser interaction and screenshots in ignored `artifacts/`; no horizontal page overflow. |
| JSON device export | PASS | Downloaded JSON contains events and leaves all manual checks as NOT RUN. |
| Public search / YouTube.js 18.3.0 | PASS | Fixed query returned 20 songs, including `4D7u5KF7SP8`. First measured query took 764 ms, including session initialization. |
| Public search / ytmusicapi 1.12.3 | PASS | Same query returned the same leading song ID. Entire Python public probe took 1.757 seconds. These timings cover different work and are not a benchmark. |
| Misspelling | PASS in both libraries | `Daft Pnk Get Luky` returned `4D7u5KF7SP8` first. |
| Non-Latin query | PASS in both libraries | `周杰倫` returned `t0AvpJ74sBc` first. This proves these sample requests, not general search quality. |
| Same public playlist | PASS in both libraries | `PLKnoch_ESAUI`, titled Daft Punk: both read 53 items; YouTube.js reported no further page. ytmusicapi can return an entire page exceeding its requested limit. Long-playlist continuation remains NOT RUN. |
| Basic player response / WEB | FAIL for this approach | `UNPLAYABLE`, reason `Video unavailable`, zero audio formats. Probe deliberately disabled JS player retrieval. This does not establish that a properly integrated WEB player cannot work. |
| Basic player response / ANDROID | Response received; playback NOT RUN | `OK`, six audio formats, zero direct audio URLs, SABR URL present. No audio bytes were fetched or played. |
| Authenticated library and playlist operations | BLOCKED | Needs owner-provided local browser-auth file. The separate script is ready; its write safety and duplicate handling have automated tests, not live account proof. |
| Actual YouTube audio in Coda | NOT RUN | No stream resolver, SABR delivery, or browser media integration is implemented. Must investigate current library playback examples before claiming this works. |
| Premium behavior | NOT RUN | Public tests cannot establish subscription behavior. |
| Zen and physical Chrome/Android | NOT RUN | Owner must perform device checklist, including ten minutes with screen locked. |

Raw sanitized public probe snapshots: [YouTube.js](evidence/youtubejs.json), [ytmusicapi](evidence/ytmusicapi.json). These contain no credentials or signed media URLs. A PASS on the JSON player-response request only means the request completed; `playbackTested` remains false.

## Automated verification

- `npm test`: three server tests pass: explicit public-file serving, audio range/seek support, and method/origin/input rejection before upstream requests.
- `python3 -m unittest discover -s tests -p '*_test.py'`: three account-flow safety tests pass against a fake service, not a real account.
- The same Python tests pass with `python3 -O`; stopping conditions remain active when Python assertions are disabled.
- `npm run test:browser`, with `CHROMIUM_PATH` pointing to installed compatible Chromium: passed real generated-audio interaction and JSON export.
- Node syntax checks and `git diff --check`: pass.
- `npm audit --omit=dev --audit-level=high`: no production vulnerabilities reported at test time.

T3 preview could not start: `This host blocks the sandbox T3's browser runs in (AppArmor on Ubuntu 23.10+).` A standalone Playwright runner using an existing headless Chromium with `--no-sandbox` was used for local browser verification. No host sandbox settings were changed.

The Python public probe initially failed because this ytmusicapi version has no `requests_timeout` constructor parameter. The invocation was corrected to use its documented constructor and built-in timeout; the rerun passed. This failure was in the harness, not evidence of an upstream outage.

## Conclusion for the next test

The browser harness and public data access work on this machine. Full Coda feasibility remains undecided until real YouTube audio delivery, authenticated playlist changes, and target-device behavior are demonstrated. Use the [experiment plan](experiment-plan.md) for the remaining steps and README for commands.

## Review and delivery

Independent code review is pending. This checkout has no GitHub remote, so pushing, opening a PR, and checking hosted CI require a repository destination. Local checks are recorded above; no hosted CI result is claimed.
