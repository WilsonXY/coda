# Private account library slice

The website adds a read-only My library panel, behind a configured owner identity supplied by private Tailscale Serve. Credentials stay in the local backend auth file. Existing playback remains anonymous; this panel does not play arbitrary account songs or modify playlists.

## Verification

New owner checks first failed with 404 instead of 403, the overlapping-read test failed with 200 instead of 503, the Python transport test failed with 502, and the browser test failed because the panel was absent. These checks pass after implementation. The unverified-session regression also failed before the identity check was added and now passes.

23 Node tests and 15 Python tests pass. Five Chromium fixture suites cover the original player, prepared music, progressive delivery, next-song buffering and the new account panel. The account fixture proves owner rejection before an upstream call, opening a private playlist, literal rendering of hostile titles, clearing private data on failure, ongoing playback while browsing, and layouts at 390px and 728px. Screenshots contain synthetic account data only. Physical phone and Zen checks for this new panel are NOT RUN.

T3 preview automation was unavailable because the host blocks its browser sandbox through AppArmor; the repository Playwright workflow was used without changing host policy.

## Live read-only investigation

The first worker request returned zero library playlists. Opening the earlier disposable private playlist failed in the upstream parser with KeyError. A separate account-identity request also failed with KeyError. The public comparison playlist parsed successfully (53 tracks) before mandatory identity verification was added. These observations do not establish an empty library, deletion of the disposable playlist, session expiry, or an upstream parser change. No account mutation or authentication refresh was attempted.

The worker now requires account identity verification before any library or playlist read; a detected failure produces a fixed error and the browser clears its previous account data. Identity verification cannot detect a later silently empty library parse, so zero shown does not establish an empty library. Account names and other identity fields are never returned. End-to-end live private library success remains NOT VERIFIED with the current session. The earlier CLI playlist experiment remains separately recorded in account-results.md; its success is not evidence for this website slice.

## Boundaries

Lists are capped at 50 playlists and 100 tracks per playlist; pagination and complete library inventory are not implemented. One fixed subprocess runs at a time, with bounded time/output. No shell commands or account-write operations are reachable through account routes. The default server keeps account reads disabled until all three private settings are supplied. Serve identity requires a private user-owned tailnet device and the exact configured owner; trusted local processes can forge headers. This is a personal-host trust model, not a public deployment.

## Independent review

Astra round 1 found one P2 blocking privacy-label bug: ytmusicapi 1.12.3 infers PUBLIC for non-owned playlists, including unlisted ones. Fixed by returning UNKNOWN unless owned is explicitly true, with a regression observed failing before the fix. Its P3 suggestion was also addressed: documentation now distinguishes detected parser errors from silently empty library parsing after successful identity verification. No other findings or over-engineering concerns were reported.

Actual reviewer gpt-6-astra, high effort, confirmed by the parent in the reviewer's own session log rollout-2026-10-25T00-14-39-01a16eb1-5c10-7333-b3f7-78bc2bbc3bc9.jsonl, turn-context line 10; no fallback. Parent/reviewer HEAD and clean status, and origin refs, matched before/after. The review worktree/branch were removed. Fresh Astra round 2 returned PASS: both findings resolved, with no new blocking findings or complexity concerns. The parent confirmed actual gpt-6-astra/high from rollout-2026-10-25T00-18-37-01a16eb4-fc62-7633-aa50-dd94cfbc771b.jsonl, turn-context line 10; no fallback. Parent/reviewer HEAD and clean status, and origin refs, again matched. Its clean worktree/branch were removed.


## Private preview smoke

After the reviewed branch was pushed, the owned experiment service was configured using a private mode-0600 environment file outside Git and restarted. Existing Tailscale Serve/Funnel routes stayed byte-equivalent as parsed JSON, and port 8493 remains private. The page returns 200. An account request without a Serve owner identity returns 403. A real private HTTPS owner request reaches the worker and returns the fixed session failure (502); supplying a fake incoming identity through Serve yields the same result, confirming the supplied header is replaced on this route.

A real Chromium browser using the private HTTPS URL and no manually supplied identity headers shows the fixed session error, leaves both account lists empty, keeps generated audio advancing and fits 390px/728px. This verifies the deployed failure path only; successful live private-library access remains NOT VERIFIED. See evidence/account-library-private-preview.json. GitHub reported no CI checks for this branch; local tests and independent review are the available checks.
