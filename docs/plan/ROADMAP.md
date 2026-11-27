# Roadmap

The build plan: tracks, what each deliverable needs, the order, the candidates, and what blocks a stage. `/slipway:plan` writes it; `/slipway:scope` reads one entry when it cuts a plan; nothing else reads it.

## Tracks

- **Maintenance** — follow-ups left from shipped versions: stale docs, flaky tests. D1.

## Planned

<!-- One entry per planned row: "### D<n> — <title>", its one-line scope, what it needs, the records it will likely write or touch. -->

### D1 — README status line and Windows-safe lock tests

README's status line says what works today, not 'v0.1 skeleton', on GitHub and on the docs site; the lock tests' dead-holder pid is checked to be gone before use, so they stop flaking on Windows.

- Track: Maintenance.
- Needs: nothing.
- Records: none expected; 0001 (the process) is not touched.

## Candidates
