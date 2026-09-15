# Frontend Architecture (React + Vite + TypeScript)

## Layout

```
frontend/src/
  pages/          One file per product section (Dashboard, Repositories,
                  RepositoryDetail, CodeReview, Insights, InsightDetail,
                  AnalysisRuns, AnalysisRunDetail, Reports, ReportDetail,
                  Knowledge, Settings, Login, CodeReviewCalendar)
  components/     Layout, CodeViewer, Pipeline, InsightRow,
                  AddRepositoryModal, FeedbackDialog, ScheduleMeetingModal,
                  LinkedInShareModal, ui.tsx (icons/badges/Modal — the shared
                  design-system primitives)
  context/AppContext.tsx   Auth/theme/direction/toast global state
  lib/api.ts, types.ts, format.ts, timezones.ts, linkedin.ts, socialAccounts.ts
```

## Shared primitives — reuse, don't reinvent

`components/ui.tsx` holds every icon (as inline stroke-style SVGs sharing one
`base(size)` helper), every badge variant (`SeverityBadge`, `StatusBadge`,
`badge-success`/`badge-neutral`/`badge-warning`/`badge-danger` CSS classes),
and the one `Modal` component every dialog in the app uses:

```tsx
<Modal title="..." onClose={...} footer={<>...</>} wide={false}>
  {children}
</Modal>
```

When adding a new icon, note that these icon components **do not accept a
`style` prop** — wrap them in a `<span style={...}>` if you need to
transform/position one (e.g. rotating a chevron for a "previous" button).
This is a real TypeScript error you'll hit if you try to pass `style`
directly to an `Icon.X`.

## API client

`lib/api.ts` is a thin fetch wrapper (`api.get/post/patch/del`) that reads a
JWT from `localStorage`, attaches `Authorization: Bearer <token>`, and clears
the token + throws a typed `ApiError` on 401. **All frontend fetch calls use
relative paths** (`/api/...`), never an absolute base URL — this is what
makes the Vercel same-origin deployment work with zero frontend code changes
(see `05-vercel-deployment.md`). Don't introduce a `VITE_API_BASE_URL` env
var unless the frontend and backend genuinely need to live on different
origins.

## Page/detail/modal pattern

Every "detail" page (`InsightDetail`, `ReportDetail`) follows the same
shape: load via `useCallback` + `useEffect`, `LoadingState`/`ErrorState`
components for the three request phases, and any destructive or
create/update action opens a `Modal`-based dialog component that the parent
page renders conditionally on a boolean `show*` state flag, e.g.:

```tsx
{showSchedule && (
  <ScheduleMeetingModal
    mode="create"
    sourceType="finding"
    source={finding}
    onClose={() => setShowSchedule(false)}
    onSaved={() => setShowSchedule(false)}
  />
)}
```

Follow this pattern for new features instead of introducing a different
modal/dialog convention — every existing dialog (`FeedbackDialog`,
`LinkedInShareModal`, `ScheduleMeetingModal`) does it this way.

## Navigation

`components/Layout.tsx` holds `NAV_ITEMS`/`SECONDARY_ITEMS` (sidebar) and a
`PAGE_META` array of `{match: RegExp, title, subtitle}` used to derive the
topbar heading from the current route. Adding a page means: a route in
`App.tsx`, a nav entry in `Layout.tsx`, and a `PAGE_META` regex entry — miss
the last one and the topbar silently falls back to the Dashboard's title.
