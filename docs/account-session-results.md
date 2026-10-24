# Saved account sessions and recovery

My library now has Check connection and a last-checked status. A successful check verifies account identity without returning it. This is a snapshot, not a guarantee that a later request will succeed. Library and playlist reads update the same status; the one-time write experiment does not.

An explicit upstream `logged_in=0` signal after an account-menu parser failure produces ACCOUNT_REAUTH_REQUIRED (HTTP401). Missing or contradictory signals, parser changes and transport/runtime failures remain ACCOUNT_UNAVAILABLE (HTTP502). Local auth-path/permission validation failures produce ACCOUNT_SETUP_REQUIRED (HTTP503). Disabled setup, owner rejection and a busy worker have distinct fixed codes. No exception text, account identity, request headers or raw upstream payload reaches the page. The additional account-menu read happens only after KeyError; it is not a playlist mutation or retry.

The browser clears stale library results on a detected failure and keeps the existing audio/queue. Recovery instructions appear for a rejected session or auth-file problem. Refreshing the configured file locally takes effect on the next request, because each read starts a fresh worker. No automatic login refresh, polling, mutation retry or Google login form is implemented.

## Investigation so far

The owner previously reported staying signed in while saved headers stopped passing account verification. The specific cause of those invalidations remains unconfirmed. Inspection of pinned ytmusicapi1.12.3 shows it generates a current SAPISIDHASH timestamp from the saved cookie when constructing request headers; a copied Authorization timestamp is not simply reused indefinitely.

The current regular session passed both its original-header and reduced-header read-only controls. Both controls reported authenticated account-menu signals; the auth file remained unchanged. This establishes a working baseline, not an explanation for earlier failures.

[ytmusicapi's browser setup](https://ytmusicapi.readthedocs.io/en/stable/setup/browser.html) reuses authenticated YouTube Music request headers. [yt-dlp's YouTube cookie guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies) describes cookie rotation in open YouTube tabs and a private-window export technique. Cookie rotation is a hypothesis here. We adapted the isolation idea to ytmusicapi's header capture; we did not run yt-dlp's cookie-export procedure, and its claimed behavior is not established for this adaptation.

The owner captured a separate session in a Zen private window, saved it outside Git with mode0600, and closed that window without signing out. The original auth file was preserved. Both regular and isolated sessions passed initial account checks. The isolated session also opened the same known disposable PRIVATE playlist with its expected two songs in order, using read-only requests. No account writes occurred. See [sanitized setup evidence](evidence/account-session-setup.json).

Two passive comparisons are scheduled at approximately one and two hours after setup. Each checks both files without changing them and records only states and file-age metadata locally. The timer stops after the second comparison, or earlier if the isolated file changes or is explicitly rejected. Capture ages differ (regular about17minutes, isolated about2.5minutes at baseline), so any difference is observational evidence rather than proof that isolation caused it. This short comparison cannot establish days-long session reliability. No results beyond the baseline are claimed here.

## Local recovery

Check which file the server uses in the private CODA_ACCOUNT_AUTH setting. Keep the file outside Git and all served folders, mode0600. Never paste headers into chat, Git or the website.

For this experiment's isolated file, run locally:

```sh
umask 077
"$HOME/.cache/coda-experiment/python/bin/ytmusicapi" browser --file "$HOME/.config/coda/browser-isolated.json"
```

Capture a successful signed-in POST /browse request using the dependency's instructions linked above, paste its request headers into that terminal, then finish with Ctrl+D. For the isolation experiment, use a new private window and close it after capture without signing out. Do not overwrite the regular comparison file. Choose Check connection in Coda afterward. Updating an inactive file has no effect until the private server configuration points to it. No server restart is needed when only the active file's contents change.

An unavailable/unverified result does not by itself justify replacing credentials. Check the local service/setup and retry the read first. A rejected session calls for the local refresh above. Failed or uncertain playlist writes remain a separate matter: inspect the retained journal and official playlist before any further write. This change does not reset or rerun the consumed experiment.

## Verification

The status route first failed404, typed rejection transport failed502 instead of401, Python status/classification checks failed before implementation, and the browser check failed because Check connection was absent. These tests now pass. Node31 and Python25 tests pass. The dedicated browser fixture covers connected, reconnect, setup, unverified and owner-required states; clearing private browsing data; no automatic polling; recovery on a later successful read; ongoing audio; and390px/728px layouts. Fixtures use synthetic metadata, simulated Serve identity and generated tones, never Google credentials.

All eight browser suites pass, including the seven existing player/account suites. The native T3 preview could not run because the host blocks its sandbox with AppArmor; repository Playwright is used without changing host policy. Physical Android/Zen checks of the new status/recovery controls and long-term isolated-session durability remain unverified.

## Independent review

Astra round1 returned PASS with no blocking findings and one P3 test suggestion: failing Load my playlists clears results before the request, so that fixture alone did not prove cleanup on failure. Addressed by populating the library, rejecting Check connection, and asserting that private results clear while the existing queue stays identical and audio advances. The stronger browser check passes. No production change was needed.

The parent confirmed actual gpt-6-astra/high in the reviewer's own session log `rollout-2026-10-25T03-48-22-01a16f75-0662-74c0-beca-c0bd67d32700.jsonl`, turn-context line10; no fallback. Parent/reviewer commit and clean status, and origin refs, matched before/after. The clean review worktree and branch were removed.
