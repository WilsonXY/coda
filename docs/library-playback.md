# Library songs connected to the player

The merged library feature previously displayed track metadata without playback controls. The new slice adds Play playlist, row Play and Add to queue, reusing the persistent player, queue actions and next-song browser buffering. Row Play starts at that row in the playable subset of the loaded playlist; Play playlist starts at its first valid row. Add to queue preserves ongoing library audio. It does not edit the remote playlist. Playback is anonymous, with account-session access used separately for reading the library.

## Delivery and privacy

Only the configured Tailscale owner through the loopback proxy can request valid11-character catalog video IDs. Host/origin/method checks remain. The private route uses the existing90-second/16MiB capture path, with byte-count verification before the final byte, HTTP ranges and failure reporting. The shared server cache holds at most three captures/48MiB; least-recently-used captures without active HTTP readers may be aborted/evicted. A fourth active capture is rejected, rather than exceeding that retained-cache count. Aborted capture cleanup and native HTTP/library buffers are additional transient memory. Failure does not become sample audio.

Library mode releases demo Blob URLs, defaults to buffering the next track and retains only current/next Blobs,16MiB each. For dynamically chosen songs the expected size comes from the bounded server Content-Length, checked against the completed Blob. Exported library events redact titles, video IDs and buffered IDs; the export omits playlist track IDs. The fixed-sample public diagnostics omit other catalog IDs. Google credentials, account identities and raw upstream errors are not added to these routes or exports.

## Verification

A disconnected-reader regression also failed until response setup was made interruptible without cancelling the bounded capture; this releases the reader slot for later cache eviction. The owner-gate test first failed404 instead of403; the cache-eviction regression showed the first song never being retrieved again; the browser initially lacked row Play; a rapid-selection regression let a stale rejected Play promise overwrite the currently playing song label, and a long-title layout regression overflowed the persistent player/queue. These checks pass after implementation; stale Play results are ignored once the selected queue item changes. The offline-transition fixture was corrected to buffer the current song's final seek while online before disabling networking, matching the existing buffer test: its failure was waiting for unavailable tail bytes of the first song, not a failure to buffer the next song.

The new browser fixture proves row/playlist play, Add to queue/removal, seeking, an actual buffered next-song transition while offline, no controls for unavailable rows, safe failure text, literal long-title rendering and export redaction.390px/728px screenshots contain synthetic library data. T3 preview automation failed explicitly because AppArmor blocks its sandbox; repository Playwright was used without changing host policy.

A fresh upstream probe passes playback past one second and a seek to60seconds for public song Rgrt_8mXrK8, outside the original three-sample allowlist. The actual media traverses the new protected route and UI controls; account/library metadata and Serve identity are synthetic for that probe. No real Google session was accessed by it. This is not a full continuous-song, Android, Zen, Premium or renewal test. See evidence/library-playback-upstream.json.

29 Node tests,22 Python tests and all seven Chromium fixture suites pass. The390px/728px synthetic screenshots were inspected. Independent Astra review is pending. Live private preview is not yet updated. Do not rerun the consumed account-write experiment to verify this playback slice.

## Remaining limits

The library still loads up to50playlists/100tracks; no additional pages are queued. Audio must be anonymously available and fit the per-track byte limit. Browser autoplay policy may require another Play tap. Seeking uncached bytes may wait; failed captures require eviction/restart; no automatic token/session renewal is implemented. Account login longevity remains unresolved. Physical Android locked-screen behavior and owner Zen use of this new library path await a short check; prior fixed-song device passes do not prove this path.
