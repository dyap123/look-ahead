# WEBCOR · Look-Ahead Schedule Builder

A fast, clean look-ahead schedule builder for the field. Build a foundation
schedule in minutes, see a live WYSIWYG Gantt, and export a polished
Webcor-branded PDF or an Excel workbook the rest of the team can read at a glance.

**Live:** https://dyap123.github.io/look-ahead/

## Why

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
