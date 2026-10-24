# Private account library slice

The website adds a read-only My library panel, behind a configured owner identity supplied by private Tailscale Serve. Credentials stay in the local backend auth file. Existing playback remains anonymous; this panel does not play arbitrary account songs or modify playlists.

## Verification

New owner checks first failed with 404 instead of 403, the overlapping-read test failed with 200 instead of 503, the Python transport test failed with 502, and the browser test failed because the panel was absent. These checks pass after implementation. The unverified-session regression also failed before the identity check was added and now passes.

23 Node tests and 14 Python tests pass. Five Chromium fixture suites cover the original player, prepared music, progressive delivery, next-song buffering and the new account panel. The account fixture proves owner rejection before an upstream call, opening a private playlist, literal rendering of hostile titles, clearing private data on failure, ongoing playback while browsing, and layouts at 390px and 728px. Screenshots contain synthetic account data only. Physical phone and Zen checks for this new panel are NOT RUN.

T3 preview automation was unavailable because the host blocks its browser sandbox through AppArmor; the repository Playwright workflow was used without changing host policy.

## Live read-only investigation

The first worker request returned zero library playlists. Opening the earlier disposable private playlist failed in the upstream parser with KeyError. A separate account-identity request also failed with KeyError. The public comparison playlist parsed successfully (53 tracks) before mandatory identity verification was added. These observations do not establish an empty library, deletion of the disposable playlist, session expiry, or an upstream parser change. No account mutation or authentication refresh was attempted.

The worker now requires account identity verification before any library or playlist read; a failure produces a fixed error and the browser clears its previous account data. Account names and other identity fields are never returned. End-to-end live private library success remains NOT VERIFIED with the current session. The earlier CLI playlist experiment remains separately recorded in account-results.md; its success is not evidence for this website slice.

## Boundaries

Lists are capped at 50 playlists and 100 tracks per playlist; pagination and complete library inventory are not implemented. One fixed subprocess runs at a time, with bounded time/output. No shell commands or account-write operations are reachable through account routes. The default server keeps account reads disabled until all three private settings are supplied. Serve identity requires a private user-owned tailnet device and the exact configured owner; trusted local processes can forge headers. This is a personal-host trust model, not a public deployment.

Independent Astra review is pending.
