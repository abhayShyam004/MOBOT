# Android Phase J: Native Structured Response System

The Android companion client renders first-class native Jetpack Compose components
for structured data responses instead of markdown text.

## Architecture

The model emits responses following the `mobot/v1` structured protocol envelope.
The host parses and validates against the component registry (`StructuredResponse.kt`),
applies bounds and protocol sanitization, and renders semantic Jetpack Compose controls.

16 native component types are supported:
- **`card`**: Semantic alert/status cards (`info`, `success`, `warning`, `error`, `recommendation`), metadata tables, action pills.
- **`dashboard`**: Mobile KPI metric tiles, deltas, compact telemetry grid.
- **`diagram`**: Architecture & flowchart nodes with directed edges and textual accessibility representations.
- **`table`**: Mobile tabular data with headers, status chips, and alignment.
- **`checklist`**: Interactive task lists with strikethrough styling and live progress calculation.
- **`kanban`**: Horizontal stage navigation with task cards and assignee chips.
- **`form`**: Native inputs, toggles, sliders, and submission actions.
- **`gantt`**: Milestone roadmap bars and project timeline tracking.
- **`artifact`**: Code & file artifact previews with metadata chips and action pills.
- **`map`**: Coordinate location pins with explicit Android Map intent invocation.
- **`calendar`**: Agenda schedule with chronological events and category tags.
- **`media`**: Responsive images with aspect ratio framing and captions.
- **`code`**: Monospace developer views with language tagging and line numbers.
- **`sources`**: Sanitized reference links with domain badges.
- **`comparison`**: Multi-option spec evaluation and pros/cons lists.
- **`decision_matrix`**: Weighted criteria evaluation with score sums.

## Automated Verification

### TypeScript & Vitest (`shared/structured-response.test.ts`)
```sh
npx vitest run shared/structured-response.test.ts
```
7 passed (100%):
- `validates a well-formed multi-component structured response`
- `sanitizes dangerous URLs and non-http protocols in sources`
- `bounds oversized payloads and row counts safely`
- `handles unknown component types by degrading gracefully to semantic card`
- `rejects unsupported future protocol versions`
- `generates faithful markdown fallback text for accessibility and screen readers`
- `validates all 16 component types in the registry`

### Android Unit Tests (`StructuredResponsePresentationTest`)
```sh
./gradlew :app:testDebugUnitTest --tests "com.openmausbot.companion.ui.StructuredResponsePresentationTest"
```
11 passed (100%):
- `supports dashboard metrics and alert components`
- `supports interactive form components`
- `supports rich media components`
- `supports semantic card variants`
- `supports diagram components and node connections`
- `supports map coordinates markers and routes`
- `component actions are serialized correctly`
- `supports calendar agenda and recurring schedule serialization`
- `supports artifact preview and metadata`
- `supports gantt timeline tasks and milestones`
- `serializes and deserializes structured response message correctly`

## Device Verification

Verified directly on Samsung Galaxy SM-A075F (`R8YY90VT4EM`, Android 16):
- **Dark Theme**: Rich rendering with alpha surface tinting and accessible contrast.
- **Light Theme**: High-contrast rendering conforming to WCAG AA.
- **Touch Interaction**: Tapping the map action opens Google Maps via `geo:` Intent without intercepting list scroll gestures.
