# CLAUDE.md — working conventions for this repo

Read `SPEC.md` first, then `EXERCISES.md`. This file is only the ground rules.

## Who you are working with
The project owner is not a programmer and not an electrical engineer. He cannot
read your code to check it. That changes how you should work:

- **Never claim something works because it compiles.** Prove it with a test the
  owner can run or a screen he can look at. `EXERCISES.md` has the numbers.
- **Keep `STATUS.md` current** (create it on the first session). One screen: what
  works, what's next, what's broken, and a plain-language "how to check it"
  for anything finished this session. Update it before ending every session.
- **The in-app Self-Check page (`/#/selfcheck`) is not optional.** It loads all
  seven exercise circuits, runs them, and shows green/red against the reference
  values. The owner will use it as his primary way of knowing the solver is right.
- When you hit a design decision the spec doesn't settle, choose the option
  that is easiest to reverse, do it, and record it in `DECISIONS.md` (one line:
  date, decision, why). Ask the owner only when the choice is visible to students
  and hard to undo.
- Explain things in plain language in `STATUS.md`. "Netlist extraction" is fine
  in code comments; in `STATUS.md` say "turning the drawn wires into a circuit."

## Engineering rules
- TypeScript everywhere, strict mode. No `any` in the solver.
- The solver (`src/engine/`) has **zero** dependencies on the UI and no DOM
  access. It must run in Node for tests. It takes a netlist object and returns
  numbers. Everything else is a client of it.
- Tests: `vitest`. Every exercise in `EXERCISES.md` is a test with the stated
  tolerance. Run `npm test` before every commit. A red test is never committed
  as "known issue"; either fix it or mark it `.todo` with a note in `STATUS.md`.
- Netlist extraction from drawn geometry (`src/schematic/extract.ts`) gets its
  own tests with deliberately awkward layouts (see SPEC §7.3).
- Small commits, plain-language messages ("Add capacitor companion model for
  transient analysis", not "wip").
- No backend, no accounts, no analytics, no network calls at runtime. The whole
  app is static files. If you find yourself wanting a server, stop and write it
  in `DECISIONS.md` as a question.
- Don't add a dependency for something under ~200 lines. The solver in
  particular is hand-written (see SPEC §4 for why).
- Prefer boring, well-known libraries. Vite + React + Vitest + Playwright. One
  plotting library max (see SPEC §4.4).

## Order of work
Follow the milestones in SPEC §8 in order. M0 (solver + tests, no UI) must be
fully green before any UI work starts. This is deliberate: it converts the
physics risk to zero before the expensive part begins.
