# Social Accounts (Facebook / Instagram / LinkedIn) — Demo-Only, By Design

This feature exists to satisfy a homework requirement ("connect social
accounts") adapted honestly for a code-analysis product that has no real
reason to post to social media on a user's behalf. **The distinction between
real and demo functionality is the entire point of this feature** — get this
wrong and the feature misrepresents itself.

## Hard constraints (do not cross these, ever)

- **No real OAuth flow.** Don't request, collect, store, or transmit a
  password, access token, API key, cookie, or OAuth client secret for
  Facebook, Instagram, or LinkedIn — even if a user asks for "real"
  integration, unless they can actually supply a registered Developer App's
  credentials through their own OAuth setup (not through chat).
- **No scraping, no browser automation** pretending to be a login.
- **No fake backend infrastructure** that *looks* like a real integration
  (a "social media service," a posts database, a scheduler) when nothing
  real is happening behind it. If real credentials aren't available, stop
  at the UI + a clearly-labeled simulated flow — don't build a Potemkin
  backend to make the mock feel more "real" than it is.
- **TikTok is deliberately excluded**, not merely unimplemented — state the
  reason in the UI: DevIntel produces technical developer insights and
  reports, not short-form video/entertainment content, so a TikTok
  integration doesn't fit the product's purpose regardless of API
  availability.

## What "Connect" is allowed to do

Plain browser navigation to that platform's **real, official** login page —
nothing more:

```ts
window.open("https://www.linkedin.com/login", "_blank", "noopener,noreferrer");
```

This is genuinely safe: it's the same as a user manually typing the URL
themselves. Immediately after, mark the account as demo-connected in local
state — this models the *shape* of a connect flow (click → external auth →
"connected") without any of the actual OAuth mechanics.

## What "Sync Accounts" is allowed to do

A `setTimeout`-based fake delay, then flip all accounts to "connected" with
a "last synced" timestamp. No network request to any external provider
(the homework's example mentioned a service called Blotato — no call is
made to it or anything like it). Label the result explicitly: *"Demo sync
complete — N accounts synchronized. No real API call was made."*

## Where connection/sync state lives — and why

**`localStorage`, scoped to the visitor's own browser. Never Supabase, never
the backend.** This isn't a shortcut — it's a requirement, because:

1. DevIntel is a **publicly deployed, multi-tenant** app. If "connected"
   state were written to a shared table, one visitor's demo toggle could
   leak into another visitor's view of the app, or worse, be mistaken for
   that *other* visitor's real social account status.
2. It keeps the blast radius of a demo feature at zero — nothing it does
   can affect real user data, real RLS-protected tables, or the real
   analysis pipeline.

If a future real OAuth integration is ever built, that's the point where
this state would need to move to a proper per-user, RLS-protected table —
don't do that migration speculatively while the feature is still a demo.

## A real bug this project hit: two disconnected "connected" flags

An earlier iteration had a **separate** LinkedIn-sharing feature (turning a
Finding/Report into a LinkedIn post draft) with its own, independent
`localStorage` key for "is LinkedIn connected," built before the general
Social Accounts section existed. Once the Social Accounts feature was added
with its *own* unified connection state, the LinkedIn-sharing feature was
left reading the old, now-orphaned key — so a user could see "Connected" in
Settings while the sharing modal still thought LinkedIn wasn't connected (or
vice versa).

**Fix**: consolidate to a single source of truth. Any feature that needs to
know "is platform X connected" reads from the same shared state module
(`loadAccountStates()` in this project) — never invent a second, parallel
flag for the same underlying concept, even if it's just a demo. When you
find yourself about to add a `localStorage.getItem("something_connected")`
call, check whether an existing state module already answers that question.

## What a *real* LinkedIn OAuth integration would actually require

Document this for contrast, so nobody assumes it's a small step away from
the demo:

- A registered LinkedIn Developer App.
- Its Client ID and Client Secret (server-side secret, never in frontend
  code).
- An approved OAuth 2.0 redirect URI registered with LinkedIn.
- The `w_member_social` scope (plus `openid profile email`) granted through
  LinkedIn's own consent screen.
- A backend token-exchange endpoint and secure token storage per user.

None of this exists in the current build. Say so plainly if asked whether
the integration is "real" — don't let a confident-sounding UI answer that
question instead of you.
