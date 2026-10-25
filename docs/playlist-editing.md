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
