# Editing owned playlists

My library → **Load my playlists with Google** → Open playlist → **Edit playlist**. Move songs up/down, remove an occurrence, or use **Find songs** and **Add to draft**. **Save to YouTube** sends the draft; **Discard draft** leaves YouTube unchanged. Playback and its queue stay independent of this draft.

The owner confirmed that playing, seeking and skipping from the Google-connected view worked before this change. The editor's automated proof uses synthetic playlists and simulated Google responses; no real playlist edits were made during implementation.

## Permission and bounds

Existing broader Google authorization can be reused. A read-only grant can still browse and play; **Allow playlist saving → Enable Google playlist editing** explicitly requests `https://www.googleapis.com/auth/youtube` (Google: Manage your YouTube account). Connecting leaves the page and stops playback. No permission is widened automatically, and no cookie/header refresh is involved. The optional direct-Music OAuth diagnostic remains separate.

Editing is available for ordinary PL playlists in the first 50 owned playlists returned by Google. The entire playlist must fit within 100 tracks, with valid video and occurrence IDs. Truncated playlists, unavailable entries and Music-only collections remain playable where possible but cannot be edited here. At most 10 API mutations are accepted in one save; larger drafts must be reduced before saving. Removing an entry does not rewrite the positions of every later song.

The existing anonymous Music search supplies at most 30 song results. Search terms, private playlist contents and editing tickets are not added to the exported device log. Drafts are in page memory only; leaving/reloading an unsaved draft asks before discarding it.

## What a save does

The owner-only HTTPS `POST /api/account/oauth/save` accepts at most 32 KiB JSON with playlist ID, single-use editing ticket and ordered occurrence/video IDs. The server validates the whole draft before writing. It reads the playlist again and compares occurrence identities and order with the original snapshot, rejecting an already changed playlist without writes. Duplicate videos remain distinguishable by their playlist-item IDs.

A ticket expires after ten minutes, is replaced when another Google playlist is opened, and disappears on restart. It is consumed before the save preflight. One OAuth action runs at a time; a consumed ticket cannot replay, including after a timeout, disconnect or restart. Validation errors before consumption allow a smaller draft. Other save failures require reloading and inspection before another edit. Google errors and bodies are not exposed.

Only the official [playlistItems.insert](https://developers.google.com/youtube/v3/docs/playlistItems/insert), [update](https://developers.google.com/youtube/v3/docs/playlistItems/update) and [delete](https://developers.google.com/youtube/v3/docs/playlistItems/delete) endpoints are used. Removed occurrences are deleted first, followed by required inserts/moves. Each request has a ten-second deadline, no redirects and no automatic retry. The frontend allows three minutes for bounded preflight, writes and final readback. Successful Save requires the final video order and surviving occurrence IDs to match the draft.

**Saving is not atomic.** A failure may leave some requested changes on YouTube, including removals. There is no automatic rollback. An external edit made during the multi-request save can also race; the final readback can report a mismatch but cannot prevent every concurrent edit. Avoid editing the same playlist in another client while saving. Reverting Coda's code does not undo saved playlist changes or restore removed occurrence identities. Playlist title/visibility and the old consumed one-time test journal are untouched.

## Verification

`npm test` covers authenticated origin and permission checks, draft validation, duplicate-aware edits, stale snapshots, no replay, ambiguous failures and bounded plans. `npm run test:oauth` runs the HTTPS browser flow with simulated Google: draft edits/search cause zero writes, Save applies the exact desired order, discard sends nothing, conflict stops before writes, and an uncertain write disables resubmission. Synthetic screenshots at 390px/728px are kept under ignored artifacts. Existing library playback tests cover continued audio and private export redaction.

The product-native preview was attempted, but returned: “Preview automation open failed: This host blocks the sandbox T3's browser runs in (AppArmor on Ubuntu 23.10+).” The repository's Playwright commands are the fallback. Physical Android/Zen editing, real Google mutations, real concurrent edits and quota exhaustion are not established by these fixtures.

## Independent review

Astra round 1 found one P2 draft-loss bug: the legacy one-time test button cleared an unsaved Google draft without confirmation. Fixed by applying the existing discard guard before marking the test attempted; the browser regression dismisses that prompt and verifies the draft survives, no test request is sent and the button remains usable. The optional P3 finding about wasted reorder calls was also fixed: reorder-only drafts compare forward/backward moves, so moving the first or last song to the opposite end uses one update. The six targeted edit tests pass. The small planner remains greedy rather than solving for the globally smallest update set; the ten-write ceiling is enforced on its chosen plan.

The first reviewer was actual `gpt-6-astra`, reasoning `high`, independently confirmed from its own `rollout-2026-10-25T15-21-56-01a171ef-ff6f-72f1-9df4-00f81d22386b.jsonl`, turn-context line 10, with no fallback. Its worktree had no installed youtubei.js/Playwright dependencies, so its npm suite did not start; it ran dependency-free generated planner checks instead. Parent and reviewer HEAD/status plus origin refs were unchanged, and the clean review worktree and branch were removed. Round 2 returned PASS with no blocking findings or over-engineering findings. It independently checked 34,384 generated plans, the production handler in a VM, malformed/oversize bodies, syntax and whitespace. Both prior findings were confirmed resolved. Actual `gpt-6-astra`, effort `high`, was confirmed independently from `rollout-2026-10-25T15-28-10-01a171f5-b406-7b00-ae1d-c21eee9c688a.jsonl`, turn-context line 10, with no fallback. Full reviewer suites remained unavailable without installed dependencies; parent verification passed 42 Node tests and nine browser suites, with OAuth and the legacy playlist test repeated after fixes. Parent/reviewer HEAD/status and origin refs remained unchanged; the clean worktree and branch were removed.

## Private preview

After the reviewed branch was pushed, the existing owned coda-experiment user service was restarted. An immediate first attempt failed opening the page; its exact cause was not retained. Local and private HTTPS readiness checks then both returned200, and one bounded repeat passed: actual Google owned-list/private-playlist reads, existing grant enabling Edit, local reorder followed by Discard with zero save requests, continued generated tone, and 390px/728px fit. Tailscale Serve configuration was unchanged. No real account mutations or new Google consent occurred. See [sanitized live evidence](evidence/playlist-edit-private-preview.json). A real Save remains an owner acceptance check; fixture writes do not prove upstream write acceptance.
