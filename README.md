# SuperYap — Superintendent Suite

An all-in-one field suite for construction superintendents, on the shared OpenYap
Firebase. Scheduling is the first feature; Attendance and Tools read live from the
sibling apps so the super sees everything in one place.

**Live:** https://dyap123.github.io/look-ahead/

## Tabs

- **Schedule** — the look-ahead builder (see below). Webcor-branded PDF + Excel export.
- **Attendance** — live, read-only view of the daily sign-ins foremen submit in the
  Foreman Sign-In app (`foreman-attendance/`): who signed in per day, time in/out,
  hours, lunch/break, injury flag, and signature.
- **Tools** — live, read-only view of the tool inventory (`tool-tracker/assets`):
  search/filter by status, on-site count, monthly charge, lost count.
- **Settings** — schedule companies (legend), holidays, and the cycle template.

## Schedule — why

Replaces the hand-maintained `ULTIMATE GANTT SCHEDULE TEMPLATE.xlsx` workflow.
Two goals: stop the schedule from looking like "eye cancer," and make date entry
fast and foolproof for the super.

## How it works

- **Insert Cycle** drops in a full pre-filled foundation sequence (Layout →
  Excavate → … → Pour → Cure). Name the section, set the first start, done.
- **Per-task chain/manual toggle.** A task either *chains* to the one before it
  (auto-starts the working day after it finishes) or holds a *fixed date*. Mix
  freely. Change one duration and everything downstream ripples automatically.
- **Working-day math** skips weekends and anything on the Holidays list.
- **Live Gantt preview** is the same thing you export — colored company letters
  on a calendar grid, weekend/holiday columns shaded.
- **Export** as a wide single sheet (matches the current PDF) or tiled
  office-printer pages, plus a 3-sheet Excel workbook.

## Data

All data lives in the shared Firebase Realtime Database under the
`look-ahead-schedule/` namespace, so other apps (e.g. the CUP dashboard) can pull
it. Pour tasks can link to a Cup dashboard pour and snap to its date.
Falls back to `localStorage` when offline.

## Develop / build

Tailwind is compiled to `assets/tw.css` (committed). After editing `index.html`
classes or `tailwind.config.js`:

```bash
npm install        # first time
npm run build:css  # rebuild assets/tw.css  — REQUIRED before deploy
```

Run locally: `python3 -m http.server 8080` then open `http://localhost:8080`.

## Deploy (GitHub Pages, from main/root)

```bash
git add . && git commit -m "..."
git push
```

Pages serves `index.html` + `assets/tw.css` from the repo root (`.nojekyll`
present so `assets/` is served untouched).
