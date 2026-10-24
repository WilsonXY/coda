# OAuth experiment inside Coda

This experiment replaces manual header capture with a Google authorization page for a separate, read-only feasibility check. It does not switch the existing library connection or playback. Connect Google navigates this tab away from Coda, stopping any current audio. The later read/renew/read check stays on the page and leaves audio running.

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

Open the private HTTPS Coda page using Tailscale, then My library → **Connect Google (read-only)**. Google asks for authorization; Coda does not collect your Google password. After returning, the page says Authorization saved. Choose **Test OAuth reads and renewal**.

The backend requests only `https://www.googleapis.com/auth/youtube.readonly`. It saves a separate `~/.config/coda/oauth-web-test.json`, mode0600, in the same private mode0700 configuration directory. The existing header files, active library configuration and consumed playlist-write journal are not modified. Saving this OAuth file is a local authentication change, not a playlist write. Reverting code does not revoke the granted Google authorization or delete that file.

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

After the reviewed branch was pushed, only the owned experiment service was restarted. A real private HTTPS browser, with automatic Serve identity and no supplied identity header, sees both OAuth controls. Its explicit auth-start request returned a Google authorization URL with the expected callback, read-only scope and PKCE. The browser did not follow that URL or grant Google access. The OAuth token file and both comparison header files stayed unchanged, audio continued, and Serve configuration matched its pre-restart snapshot. A loopback request without identity returned403. See [sanitized preview evidence](evidence/account-authorization-preview.json). Google consent and real account read/renewal remain pending owner action. GitHub reports no CI checks for this branch.
