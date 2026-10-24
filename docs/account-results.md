# Account and playlist experiment

Recorded 24 October 2026 UTC/MYT with ytmusicapi 1.12.3. The existing CLI probe uses a locally supplied browser session outside the checkout, with mode 0600. Credentials are neither included in these records nor connected to the web player. See [derived evidence](evidence/account-playlist-2026-10-24.json).

Authenticated library reads passed. This is a bounded response check, not complete library inventory or pagination verification. Nine existing account-harness checks also pass. No player, server or account-integration implementation changes were needed for the experiment.

## Initial attempt and inspection

The standard write probe created one private playlist, `PLWEPAqmCfbhY`, titled `Coda experiment 2026-10-24T15:21:56+00:00`. It then failed with `KeyError` before recording its first readback step. No add/move/remove call was reached. The initial attempt stays **FAIL**; no creation or mutation was retried.

A later read-only request returned the new playlist as PRIVATE with its two expected songs. The first response and exact missing key were not captured, so delayed availability or an alternate response shape remain hypotheses, not a confirmed cause. This is a limitation for unattended automation, not a clean standard-probe pass.

## Controlled continuation

After inspecting current state, a one-off continuation used the same newly created playlist. Each readback required PRIVATE, owned, the expected test title/time/description and song order. Intent was recorded locally before each single mutation call; a failure would stop without retrying a write. No second playlist was created and no other existing playlist was modified.

Let A be `4D7u5KF7SP8` and B be `Rgrt_8mXrK8`:

| Action | Expected and observed order |
| --- | --- |
| Inspect previously created playlist | A, B |
| Add duplicate A | A, B, A |
| Move appended A to front | A, A, B |
| Remove that exact appended occurrence | A, B |

All four readbacks passed with PRIVATE/owned confirmed. Distinct playlist-item identifiers verified which duplicate moved and was removed, and both original item identities survived. Record **PASS_API_READBACK** for this continuation, separately from the initial failed probe.

The final two songs are Get Lucky (feat. Pharrell Williams and Nile Rodgers), then Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers). The private test playlist is left intact for owner inspection at [YouTube Music](https://music.youtube.com/playlist?list=PLWEPAqmCfbhY). The owner supplied an official-site screenshot showing the matching playlist ID, Private, exactly 2 tracks, and those songs in that order. Record **PASS_API_AND_OFFICIAL_SITE** for this scoped experiment. The source screenshot hash and observed fields are recorded; the image is not committed or uploaded because unrelated account/sidebar details are visible. The continuation report keeps its original pre-screenshot NOT RUN field for provenance; the later screenshot completes acceptance.

## Limits and next work

This establishes account reads and the specific new-playlist operations for the current browser session. Session expiry, reauthentication/logout, partial-failure recovery, general catalog/pagination, other existing playlists and Premium-linked playback remain unverified. The website still has no authenticated account/write endpoints. Before exposing account operations in Coda, implement a minimal backend workflow with explicit owner access controls and credentials confined to the backend.

Evidence source hashes, consistency assertions and whitespace checks pass. No app regression suite is rerun for this documentation-only update. Independent review passed as recorded below. No further account mutations are needed for this experiment.


## Independent review

Astra returned PASS with no findings or suggestions. It checked source hashes, the preserved continuation report, single-playlist scope, mutation order/counts, item-identity guards and the private screenshot. Initial FAIL, continuation PASS_API_READBACK and later official-site acceptance remain distinct. No continuation execution, account requests, credential access or artifact writes occurred during review. The parent independently verified actual reviewer `gpt-6-astra`, effort `high`, from the reviewer's own Codex session log `rollout-2026-10-24T23-39-07-01a16e90-d312-7b62-b531-09703cbf8de1.jsonl`, turn-context line 10; no fallback. Parent/reviewer HEAD/status and origin refs stayed unchanged. The review branch was renamed externally at the same commit; the reviewer issued no mutations. Its clean worktree/final branch were removed afterward.
