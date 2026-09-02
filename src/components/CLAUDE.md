# src/components

Components are read far more often than they are written. Optimise for the reader.

## One screenful, one job

- A component file that passes ~150 lines is telling you it does more than one thing. Split it.
- If you cannot name a component after the single thing it renders, it does not have a single job yet.
- Extract a subcomponent when a block of JSX has its own name in the product — `DatasetSchemaTable`,
  `TimezoneWarning` — not merely because a file feels long.

## Flat over nested

- Handle states with early returns, never nested ternaries in JSX:
  loading → return, error → return, empty → return, then the happy path unindented at the end.
- More than ~3 levels of JSX nesting in one component: extract the inner level.
- No logic inside JSX. Compute above the `return`, give it a name, use the name.

## Props that read like a sentence

- No boolean-prop proliferation (`isCompact`, `hasHeader`, `showFooter`, `variantB`). When booleans
  accumulate, the component is really several components — compose instead of configure.
- Explicit prop types, always. No `any`, no unknown-prop spreading (`{...rest}`) onto a domain
  component; that hides the contract from the reader.
- Name props with the vocabulary in `CONTEXT.md`. UI copy says "workspace"; props and types say
  `organization`.

## State

- Derive, do not synchronise. If a value can be computed from props during render, compute it —
  never mirror props into state with an effect.
- `useEffect` is for synchronising with something outside React. Reach for it last, and say in a
  comment what external thing it synchronises with.
- Server Components by default. `"use client"` goes on the smallest leaf that genuinely needs
  interactivity, never on a layout or page for the sake of one button.

## What not to build

- No abstraction for a single use. Two call sites is a coincidence; three is a pattern.
- No configuration option nobody asked for. Add the prop when the second caller needs it.
- No wrapper that only forwards props.

## Every component

- Real semantic elements: `<label>` tied to its input, `<button>` for actions, headings in order.
- Visible focus, keyboard operable, correct in light and dark.
- Colocate its test beside it. A component with a state machine (loading/empty/error/data) has a test
  per state.
