# OAuth experiment inside Coda

The Google connection now provides an owned-playlist view through the official YouTube Data API. It is separate from the original saved Music session and the direct Music OAuth comparison. Connect Google navigates this tab away from Coda, stopping any current audio. Browsing and the read/renew/read check stay on the page and leave audio running.

## One-time Google setup

On the computer where you use Google Cloud Console:

1. Create/select a Coda Google Cloud project and enable YouTube Data API v3.
2. Configure Google Auth Platform's app information and audience. For personal testing, use External / Testing and add your own Google account as a test user.
3. Create an OAuth client of type **Web application**. This experiment uses Google's web-server authorization-code flow, not a TV/device client.
4. Register the exact redirect URI for your private Coda origin. On this host it is `https://penguin.tail813aca.ts.net:8493/api/account/oauth/callback`.
5. Download the Web client's JSON. Keep it private, outside this repo and all served folders.

Google describes [web-server authorization and offline access](https://developers.google.com/identity/protocols/oauth2/web-server). This flow deliberately differs from [ytmusicapi's documented TV/device setup](https://ytmusicapi.readthedocs.io/en/stable/setup/oauth.html); compatibility with YouTube Music must be measured separately. The official YouTube Data API private-playlist check and the unofficial Music check are reported independently.

### If your browser is on a different computer from the server

The downloaded JSON is on your PC. An SSH shell's Downloads folder belongs to the remote server. Rename the downloaded file `oauth-client.json` in your PC's Downloads folder. The server's private `~/.config/coda` folder should already exist with mode0700.

Run this in a **local terminal on your PC, outside SSH** (substitute your normal SSH address if needed):

```sh
scp "$HOME/Downloads/oauth-client.json" penguin@penguin.tail813aca.ts.net:/home/penguin/.config/coda/oauth-client.json
```

Then on the **server**, restrict the copied file:

```sh
chmod 600 "$HOME/.config/coda/oauth-client.json"
```

When working with the coding agent, the agent can set that permission on the server after you report the copy is complete. Do not send the JSON or client secret through chat. You can remove the extra PC download after confirming the server copy is correct.

## Run the short experiment

Open the private HTTPS Coda page using Tailscale, then My library → **Connect Google (read-only)**. Google asks for authorization; Coda does not collect your Google password. After returning, choose **Load my playlists with Google**, open a playlist and use Play playlist, row Play or Add to queue. Existing Google authorization can be reused without reconnecting. **Test OAuth reads and renewal** remains an optional comparison with the direct Music API; its Music failure does not prevent the official playlist view from working.

The default Connect Google (read-only) button requests `https://www.googleapis.com/auth/youtube.readonly`. A separate, explicitly chosen Connect Google for Music button requests ytmusicapi's standard `https://www.googleapis.com/auth/youtube` scope, described by Google as Manage your YouTube account. That grant permits account changes; the implemented experiment still only performs reads and token renewal. The broader choice is explained before its button and is never requested automatically. The selected permission is retained through token renewal; a callback that does not grant the requested scope is rejected. It saves a separate `~/.config/coda/oauth-web-test.json`, mode0600, in the same private mode0700 configuration directory. The existing header files, active library configuration and consumed playlist-write journal are not modified. Saving this OAuth file is a local authentication change, not a playlist write. Reverting code does not revoke the granted Google authorization or delete that file.

Each explicit probe reads the known disposable private playlist through the official Data API and through ytmusicapi, recording booleans only. It then exercises the access-token expiry/renewal branch in memory, saves the renewed token privately, and repeats both reads. It does not alter the stored expiry just to trigger renewal and does not wait for a real hour. A genuinely near-expiry token takes the same renewal branch before its first read. No playlist is created, edited or deleted. If the disposable playlist is missing or its two-track order has changed, the result cannot pass.

PASS requires official private-playlist access plus Music identity verification, PRIVATE visibility and the expected two-song order, both before and after renewal. A successful Google consent alone does not prove Music compatibility. If only the official API passes, the next decision is which Coda features can use that API; do not silently fall back to the old headers and call OAuth successful. A probe error or partial comparison leaves the current library connection in place.

## Boundaries and security

Only the configured owner behind loopback Tailscale Serve can start the flow or probe. POST actions require the exact private HTTPS origin and accept no parameters/body. Google returns through a cross-site GET, so that callback uses owner identity plus a random one-use state, a Secure/HttpOnly/SameSite=Lax cookie, a ten-minute deadline and PKCE. A callback without its browser cookie, with a wrong/duplicate state or after consumption cannot exchange a code. Token exchange uses a fixed Google HTTPS endpoint; errors and upstream bodies never reach the page. The callback redirects to a fixed result URL with no authorization code and sets no-referrer. Tokens and client secrets never enter exports, app logs or screenshots.

One OAuth action runs at a time. Google token calls have ten-second deadlines; each fixed Python read subprocess has a twenty-second deadline and16KiB output ceiling. Only booleans leave the read worker. A normal probe can take up to50seconds; a token that already needs renewal can add another10seconds. There are no scheduled OAuth polls or automatic account mutations. A server restart invalidates pending login state; reconnect if that happens. Local processes and the host remain trusted, as with existing owner access.

Google documents that external apps in **Testing** receive refresh tokens that expire after seven days for scopes such as YouTube access. That is a known setup limit, even if the short renewal test passes. [Google token expiration guidance](https://developers.google.com/identity/protocols/oauth2#expiration). Moving beyond Testing and any associated setup/verification is a later decision. No indefinite-login guarantee is made.

## Verification status

Backend tests first failed405 because the OAuth routes were absent, and the browser test could not find Connect Google. They now pass with synthetic Google responses. Tests cover owner/origin rejection, browser-bound callbacks, wrong/missing/duplicate state, one-use handling, private token storage, denied unsafe file permissions, fixed errors and renewal. The Python check separately verifies official/Music outcomes and omission of private metadata. A regression for required standard headers was observed failing before they were added to the bearer client. The HTTPS browser fixture simulates Google and Serve identity, exercises the callback cookie and read/renew/read controls, keeps audio advancing during the probe, and checks390px/728px layouts. No Google account is used by these fixtures.

Real Google consent, read-only scope compatibility with Music, token renewal and physical Zen/Android behavior remain pending until the owner supplies the private Web client and completes consent. The native T3 preview is blocked by host AppArmor; repository Playwright is used without changing host policy.

The owner has now copied the Web client to the server. Local preflight confirms mode0600, required client fields and the expected registered redirect, without exposing their values. Google consent and real compatibility checks remain pending. All33 Node tests,26 Python tests and9 browser suites pass; the OAuth browser suite passed again after its final small timeout/fixture adjustment.

## Independent review

Astra returned PASS with no blocking security/correctness findings and no unnecessary complexity. Both low-priority suggestions were addressed: the browser fixture now holds a probe pending and proves audio advances during that interval, and the renewal fixture omits the refresh token and verifies the saved original is preserved. The two OAuth Node tests and strengthened HTTPS browser suite pass after these test-only changes; no production code changed after review. See [sanitized fixture evidence](evidence/account-authorization-fixture.json).

Actual reviewer gpt-6-astra/high was confirmed by the parent in the reviewer's own `rollout-2026-10-25T04-10-52-01a16f89-9fee-7ef0-830e-5d8e936e7d97.jsonl`, turn-context line10; no fallback. Parent/reviewer commit and clean status, and origin refs, matched before/after. The clean review worktree and branch were removed. The reviewer independently ran the two Node tests and one Python test and checked installed ytmusicapi bearer handling offline; it did not perform Google consent or live account requests.

## Private preview readiness

After the reviewed branch was pushed, only the owned experiment service was restarted. A real private HTTPS browser, with automatic Serve identity and no supplied identity header, sees both OAuth controls. Its explicit default auth-start request returned a Google authorization URL with the expected callback, read-only scope and PKCE. The browser did not follow that URL or grant Google access. The OAuth token file and both comparison header files stayed unchanged, audio continued, and Serve configuration matched its pre-restart snapshot. A loopback request without identity returned403. See [sanitized preview evidence](evidence/account-authorization-preview.json). Google consent and real account read/renewal remain pending owner action. GitHub reports no CI checks for this branch.

## Live read-only result and Music scope requirement

The owner explicitly reported that Coda's read/renew/read test displayed PASS. A later independent real private HTTPS repeat returned a partial comparison: the official Data API accessed the private playlist before and after successful token renewal, while both Music checks failed. The initial owner-observed PASS is retained; the difference is not explained. Do not treat the later repeat as a full OAuth/Music pass or erase the earlier observation.

A bounded Music diagnostic separated identity and playlist requests; both raised YTMusicServerError. One instrumented identity request then confirmed HTTP403 / PERMISSION_DENIED / ACCESS_TOKEN_SCOPE_INSUFFICIENT. The saved token's metadata contains the read-only scope and not ytmusicapi's default broader YouTube scope. No exception messages, Google payloads, identities or tokens are retained in public evidence. See [sanitized partial result](evidence/account-authorization-partial.json). The library connection was not switched and no playlist writes occurred.

The optional broader-permission button is prepared for the next controlled test. Its rationale is the confirmed scope rejection and [ytmusicapi1.12.3's standard OAuth scope](https://github.com/sigma67/ytmusicapi/blob/1.12.3/ytmusicapi/constants.py). Google's [scope descriptions](https://developers.google.com/identity/protocols/oauth2/scopes#youtube) distinguish read-only access from managing the account. The original read-only button remains available, the Google Web client file is unchanged, and no new terminal setup is needed. Broader permission takes effect only if the owner chooses that option and approves Google's consent screen. A successful broader-scope Music test has NOT yet occurred.

The HTTPS fixture now models the observed partial result for read-only access and verifies that it never displays PASS. It explains the optional permission, proves no broader request occurs before clicking its specific button, and models a successful broader-scope read/renew/read afterward. Both authorization choices remain owner/cookie/state/PKCE protected. These are synthetic outcomes, not proof that broader permission fixes the live Music check.

For the optional scope choice, all35 Node tests,26 Python tests and9 browser suites pass. The broader endpoint initially failed405 and selected-scope persistence was absent before implementation. Tests cover both explicit scope choices, retaining the chosen scope across renewal and rejecting a callback that grants only read-only access after the broader choice. The current live token remains read-only until new consent.

A separate Astra review of the scope choice returned PASS with no findings or complexity concerns. It independently exercised five offline scenarios, including omitted scope on renewal and a mismatched grant preserving existing tokens. Actual gpt-6-astra/high was confirmed by the parent in `rollout-2026-10-25T04-30-09-01a16f9b-4804-7ec0-8a43-226d27d6e4db.jsonl`, turn-context line10; no fallback. Parent/reviewer commit and clean status, and origin refs, matched before/after; the clean review worktree/branch were removed. Real broader-scope authorization remains untested.

After the reviewed scope-choice branch was pushed, the owned service was restarted. A real private HTTPS smoke check confirms the optional button and its broader-permission explanation, the retained read-only button,390px/728px layouts and rejection of an invalid body before authorization starts. It did not start broader authorization or follow a Google URL. The token remained read-only and unchanged, and Serve configuration matched its snapshot. See [scope-choice preview evidence](evidence/account-authorization-scope-preview.json). The native T3 browser again reported its AppArmor sandbox block; repository Playwright was used.

## Broader grant result and official playlist view

The owner later granted the broader Music scope and sent a screenshot showing official access YES→YES, Music NO→NO and renewal YES. Metadata inspection confirmed the broader scope was saved, with mode0600. Music's rejection changed from insufficient-scope403 to generic400 INVALID_ARGUMENT for both identity and the known private playlist. Adding the native OAuth timestamp header, removing the gzip Content-Encoding declaration and using the dependency's native OAuth token handler did not establish success. These were in-memory controls only; no speculative header fix was applied. The cause of the400 remains unconfirmed. This result does not prove that all OAuth approaches to Music are impossible. See [sanitized broader-grant evidence](evidence/account-authorization-broader-result.json).

A separate control using the same token through Google's official API successfully listed owned playlists, included the known PRIVATE test playlist, and returned its two video IDs in the expected positions and order. No further permission or client-file setup was needed. The official [playlists.list](https://developers.google.com/youtube/v3/docs/playlists/list) and [playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list) routes therefore supply a working account-playlist path for Coda. This is a different API from the Music endpoints that returned400.

The new Google button uses owner-protected GET routes `/api/account/oauth/playlists` and `/api/account/oauth/playlist?id=…`. They load and renew the saved OAuth token on the backend, use fixed Google HTTPS endpoints with no redirects, and project only the existing playlist/track UI fields. Browser cookies and Music identity verification are not used. Each Google request has a ten-second deadline; at most one renewal plus three data calls are needed for a playlist (up to40seconds), and the browser allows50seconds. The existing one-action OAuth lock covers these reads too. Missing/malformed Google item arrays fail rather than silently reporting an empty library. Errors are fixed, clear private results and preserve current audio; no fallback to a browser session occurs.

Owned inventory is capped at50 playlists. A playlist uses at most two50-item pages, preserving duplicates and order up to100 tracks. Counts, continuation and completeness remain explicit; privacy comes from Google's status field. Missing IDs are unavailable rows. Titles/credits are bounded at200 characters and rendered literally. Credits use the video owner's channel name, which is not necessarily the Music artist. No general playlist editing is added, and Google metadata does not establish audio availability. Playback remains the existing anonymous, owner-protected catalog delivery. Private Google selections receive the same export redaction as Music selections.

The original Music saved-session button remains available for Music-only collections and saved playlists from other users, which the owned inventory does not enumerate. This is an explicit source choice, not an automatic account migration. Read-only Google authorization is sufficient for the official view; the optional broader grant is not required to use it. No Google account writes or consumed-journal resets occurred.

For the owned-playlist adapter,36 Node tests,26 Python tests and9 browser suites pass. The new Google GET route test failed405 before implementation, and the UI test failed because the Google load button was missing. Fixtures now cover automatic renewal with an unavailable legacy browser session, owner/parameter rejection before Google calls, private bounded projection, ordered two-page reads, source labels and playback continuing while browsing. The existing real-audio fixture also exercises Google-row Play playlist/Add to queue and confirms that exports redact those selections. See [owned-view fixture evidence](evidence/account-google-playlists-fixture.json). These fixtures do not establish fresh upstream playback or physical phone behavior for the new view.
