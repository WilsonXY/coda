# Coda: web feasibility and preparation

Research date: 23 October 2026.

## Confirmed direction

Coda is a website used from Android and a PC. The owner wants control over playlist management, visual design, search, and playback controls, with the freedom to change the interface whenever desired. A responsive web app, optionally installable as a PWA, is the starting point. Native Android development is not the initial learning requirement.

## Finding and evidence limits

The shared conversation is broadly accurate. A separate interface can use understood YouTube Music requests, but music/account data and working playback remain separate integration problems. There is no need to discover every endpoint before starting. [Shared conversation](https://chatgpt.com/share/6ada53f8-a728-83ec-bf95-638052f34860?ogimg=plain)

The web approach has concrete references: YouTube.js implements YouTube's internal API and documents browser integration through a server proxy. Its browser guide flags its inline example as outdated and points to newer example projects. Treat this as evidence of the approach, not a copy-ready recipe. [YouTube.js](https://github.com/LuanRT/YouTube.js), [browser guide](https://ytjs.dev/guide/browser-usage)

This investigation read documentation, repositories, and selected Android client source for comparison. No Coda app was implemented; no account credentials were collected; no authenticated requests, playback, or synchronization experiments were run. Current reliability on the owner's phone remains unverified.

## Proposed shape

A useful starting architecture is:

- **Browser frontend:** responsive screens, playlist interactions, search presentation, persistent queue, and playback controls.
- **Private backend:** YouTube Music request adapter, account/session handling, and playback integration where needed.
- **Small persistent store, when needed:** Coda preferences and deliberately supported local state.

Both Android and PC visit the same Coda site. Host the UI and backend under one HTTPS origin where practical. The backend can initially run on the owner's PC or an always-on private machine. A backend running on the PC is unavailable while that machine sleeps or shuts down. On a phone, `localhost` refers to the phone, not the PC.

This is a design recommendation. It does not imply that every audio byte must pass through the backend: test whether the chosen media delivery method requires proxying. If it does, seeking/range requests, bandwidth, and concurrent playback become backend responsibilities too.

### Why a static frontend alone is a poor initial assumption

Browsers enforce cross-origin request restrictions, and being signed into YouTube Music does not automatically supply Coda with an authenticated session. YouTube.js explicitly documents using a server proxy for browser requests. A successful request in DevTools or a terminal is not proof it will work from an unrelated website. [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [browser integration](https://ytjs.dev/guide/browser-usage)

Keep upstream cookies/tokens on the backend rather than shipping them in frontend bundles or browser storage. If the backend can modify the account, protect access to it and its write operations. Private network access and account login are separate concerns.

## What can be fully yours

Coda can own its layouts, colors, navigation, selection behavior, queue rules, search filters, keyboard shortcuts, touch controls, and saved preferences. Source ownership already provides the ability to change these; an elaborate plugin system or visual editor is unnecessary for the first version.

Some improvements need more than changing screens:

- **Playlist management:** local drag-and-drop is easy to demonstrate; reliable remote reorder/add/remove needs supported service operations and synchronization.
- **Search:** Coda can improve presentation, filtering, history, and local-library search. Better global catalog relevance depends on what the upstream search returns unless Coda adds its own ranking/indexing.
- **Playback:** Coda can choose queue behavior and control layout; obtaining and maintaining playable media is a separate dependency.
- **Cross-device use:** visiting the same website does not automatically provide live playback handoff or a shared queue. Those are additional features if desired.

## Integration candidates to investigate

### YouTube.js (`youtubei.js`)

A JavaScript/TypeScript route that could keep frontend and backend in one language. Current setup documentation discusses client context, Proof of Origin tokens, and a separately provided JavaScript interpreter for features such as deciphering streaming URLs. These are reasons to evaluate a working example before promising playback. [Repository](https://github.com/LuanRT/YouTube.js), [setup guide](https://ytjs.dev/guide/getting-started)

Its authentication guide recommends cookies for most web client types and says its OAuth support is currently limited to the TV InnerTube client. Therefore, a normal “Sign in with Google” button cannot be assumed to grant Coda unrestricted access to the internal Music API. [Authentication guide](https://ytjs.dev/guide/authentication)

### ytmusicapi

A Python route particularly useful for investigating Music search, library, likes, and playlist operations. It emulates browser requests; it is not a complete playback engine. Its current documentation describes both browser headers and an OAuth setup requiring client credentials. These instructions are specific to this library and do not establish that the same authentication works for another playback client. [Features](https://ytmusicapi.readthedocs.io/en/stable/), [browser authentication](https://ytmusicapi.readthedocs.io/en/stable/setup/browser.html), [OAuth setup](https://ytmusicapi.readthedocs.io/en/stable/setup/oauth.html)

Compare the two candidates using the exact operations Coda needs. Choose one initial adapter if possible; combining multiple integrations increases the number of compatibility problems to investigate. Python is an option, not a requirement.

### Other clients as references

InnerTune and Metrolist show how data, login, queues, and playback can be separated, but they are Android applications rather than web foundations. Metrolist currently declares maintenance mode. OuterTune says it is no longer actively developed. Evaluate maintenance and licenses before copying code. [InnerTune](https://github.com/z-huang/InnerTune), [Metrolist](https://github.com/MetrolistGroup/Metrolist), [OuterTune](https://github.com/OuterTune/OuterTune)

## The playback decision

**Official embedded YouTube player:** provides documented playback controls, but has player display requirements. YouTube's API policies restrict separating audio from video and background players. This does not provide unrestricted freedom for an audio-only music experience. [IFrame API](https://developers.google.com/youtube/iframe_api_reference), [API policies](https://developers.google.com/youtube/terms/developer-policies)

**Unofficial playback integration:** gives more implementation control, with ongoing compatibility work. Learn the roles of player responses, client context, signature handling, Proof of Origin tokens, and media delivery. Requirements vary by client and change over time. yt-dlp's maintainers document changing token requirements and unavailable formats/features; the same exact workaround should not be assumed to apply to every library. [Extractor notes](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube)

**Own/licensed sample audio:** use this first to test Coda's web player independently of YouTube. If background playback fails even with a normal test file, debug the browser/player before investigating the service adapter.

Do not assume a copied stream URL is permanent, or that any resolver result will play directly in every browser. Test URL renewal, media format support, seeking, range requests, headers, and whether delivery must be proxied. Do not add transcoding until an experiment demonstrates it is necessary.

## Android web constraints

The Media Session API supports metadata and handlers for media keys, notifications, and lock-screen controls in supporting browsers. It does not guarantee unlimited execution after a browser/OS suspends or terminates a page. Test the actual phone and browser. [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)

Chrome has user-interaction rules for playback with sound. Design the first play action around an explicit tap, handle rejected play requests, and test subsequent track transitions. [Autoplay policy](https://developer.chrome.com/blog/autoplay/)

A PWA can provide an installed app-like entry point. Service workers help with requests and caching and require a secure context; they are not native Android media services. Installing the site does not prove reliable lock-screen playback or confer YouTube offline-download support. [Installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing), [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

Build the player so navigation within Coda does not destroy it. A shared player at the application root is a suitable first approach. Do not infer that a service worker or frequent timer will keep the player alive indefinitely.

## Learn in this order

1. **Web requests and sessions:** HTTP, JSON, cookies versus OAuth, headers, status codes, CORS, pagination, and request inspection in browser DevTools.
2. **Frontend fundamentals:** HTML/CSS, JavaScript or TypeScript, responsive layout, application state, async requests, and one frontend framework of choice. React is an option rather than an architectural requirement.
3. **A small backend:** routes, upstream adapters, credential storage, access protection, error handling, timeouts, and deliberate remote-write operations.
4. **Web media:** HTML media elements, events, queue state, Media Session, autoplay, media formats, seeking/range requests, and lifecycle behavior on Android.
5. **Synchronization:** local versus remote state, playlist item identifiers, duplicate tracks, operation failures, and verification of changes on the official service.
6. **Private hosting:** HTTPS, phone-to-server reachability, machine availability, and updating the frontend/backend together. Use an existing private network such as the owner's Tailscale setup for the first personal deployment if suitable.

Start with the requests needed for the minimum experience. Capturing every API call or decompiling the official Android APK is unnecessary at this stage.

## Investigation milestones and evidence

These are proposed experiments, not completed checks or time estimates.

### 1. Define a small behavior target

Use the owner's priorities to choose one behavior per area. Suggested candidates to validate, not assumed requirements:

- Playlist: select several tracks and move them to another playlist.
- Search: keep songs/albums/artists separate and preserve query/results after navigation.
- Visuals: responsive layout and an easily edited theme.
- Playback: predictable “play next” and “add to queue,” with a visible editable queue.

Describe current behavior → desired behavior → observable success. “Fully customizable” initially means Coda's source and styles are under the owner's control.

### 2. Prove the browser player using sample audio

Test desktop and Android: play, pause, seek, skip, next-track transition, navigate between screens, lock the phone, background the browser, use headset controls, and return after an interruption. Try an installed PWA separately if useful. Record phone/OS/browser versions and whether failures occur with normal audio too.

Proceed when the browser behavior is acceptable for the intended daily use. If it is not, reconsider the platform or background-playback requirement before building the complete UI.

### 3. Prove data and account access

Compare YouTube.js and ytmusicapi for search, opening a playlist, pagination, and reading a private test playlist. Record whether operations need authentication and which client context works. Test session expiration/recovery and logout. Keep cookies, tokens, and unredacted HAR files out of Git and logs.

### 4. Prove playlist round trips

Using a disposable test playlist, add, remove, and reorder tracks. Include a duplicate track and a long playlist. Confirm every result on the official site after refresh. Distinguish liking a song, adding it to the library, and adding it to a playlist; these are different operations. Record how partial failures and retries behave. [Library semantics](https://ytmusicapi.readthedocs.io/en/stable/faq.html)

### 5. Prove integrated playback

Resolve and play a small varied sample through the chosen integration. Repeat the browser checks, including several automatic track transitions with the screen locked. Test seeking, network changes, backend restart, and obtaining a fresh media source. Determine whether media proxying is necessary and measure its practical cost.

Proceed only after both ordinary browser audio and the chosen YouTube integration behave acceptably. A successful search or one playable song is insufficient evidence.

### 6. Decide the foundation, then redesign

Record the chosen frontend/backend, integration/library versions, authentication method, hosting location, playback limitations, essential supported operations, and maintenance obligations. Build one complete user workflow before expanding to full visual customization.

## Terms, licenses, and distribution

Technical feasibility and permission are separate questions. YouTube's terms restrict automated access and certain reverse engineering, and its API policies restrict specific playback behavior. Personal use is not a general exemption. This research does not establish legal permission for a particular implementation. [YouTube terms](https://www.youtube.com/static?template=terms), [API policies](https://developers.google.com/youtube/terms/developer-policies)

Review the actual licenses and dependencies before reusing or distributing code. A private prototype does not establish permission to run a public service. No public deployment or account access was performed in this investigation.

## Remaining decisions

- Whether the backend should run on the PC or an always-on host.
- The phone/browser to support and whether playback must continue with the screen locked.
- Whether library/playlist changes must sync to YouTube Music from the first version.
- Required account/Premium behavior, and whether offline use or playback handoff matters.
- One concrete first workflow selected from the four UX priorities.

Recommended next deliverable: a feasibility experiment with a browser-player result, an account/playlist result, and an integrated-playback result. Use those findings to commit to Coda's foundation.
