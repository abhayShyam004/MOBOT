---
name: ui-ux-pro-max
description: "UI/UX design intelligence for web, mobile, and desktop. This skill should be used when designing, building, reviewing, or fixing interfaces, including pages, components, design systems, accessibility, interaction, responsive layout, typography, color, charts, and stack-specific UI implementation."
license: MIT
source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
revision: 50d8a7de0900119855614541f15a1a616691eb33
---

# UI/UX Pro Max - Design Intelligence

UI/UX guidance for building interfaces: layout, typography, color, spacing, responsive behavior, accessibility, interaction states, component structure, visual hierarchy, design-system decisions, UI review, and UX review.

Upstream Attribution: Created by Stanley Shen (NextLevelBuilder). Licensed under the MIT License.
Upstream Repository: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (revision `50d8a7de0900119855614541f15a1a616691eb33`).

## When to Apply

Use this skill when the task involves **UI structure, visual design decisions, interaction patterns, or user experience quality control**:
- Designing new pages and application layouts
- Creating or refactoring UI components
- Choosing color palettes, typography scales, spacing tokens, and responsive layout systems
- Reviewing UI for UX, accessibility (WCAG 2.1 AA/AAA), touch targets, and visual consistency
- Implementing navigation, animation, and responsive breakpoint behavior
- Chart and data visualization design and density decisions

Skip it for pure backend logic, database schema design, non-visual performance work, or infrastructure/DevOps — unless the task changes how something **looks, feels, moves, or is interacted with**.

## Rule Categories by Priority

Follow priority 1 to 10 when shaping UI decisions:

| Priority | Category | Impact | Key Checks (Must Have) | Anti-Patterns (Avoid) |
|---|---|---|---|---|
| 1 | Accessibility | CRITICAL | Contrast 4.5:1 (normal text), 3:1 (large text/graphics), Alt text, Keyboard navigation, Visible focus rings, Aria-labels | Removing focus rings (`outline: none`), Icon-only buttons without accessible labels, color-only state |
| 2 | Touch & Interaction | CRITICAL | Min touch target 44×44px (Android 48×48dp recommended), 8px+ spacing, instant touch-down state, loading feedback | Reliance on hover-only interactions, 0ms instant jarring state jumps |
| 3 | Performance | HIGH | Modern formats (WebP/AVIF), Lazy loading offscreen media, Reserve layout space (CLS < 0.1) | Layout thrashing, Cumulative Layout Shift, uncompressed heavy assets |
| 4 | Style Selection | HIGH | Consistent visual language, cohesive iconography (SVG icons), semantic surface depths | Mixing flat and skeuomorphic randomly, using raw emoji as functional action icons |
| 5 | Layout & Responsive | HIGH | Mobile-first breakpoints, Viewport meta, fluid columns, zero unintentional horizontal scroll | Horizontal body scroll, fixed pixel container widths on small screens, disabled pinch zoom |
| 6 | Typography & Color | MEDIUM | Base body 16px, Line-height 1.5, modular type scale, semantic color tokens (`background`, `surface`, `primary`, `error`) | Body text < 12px, low-contrast gray-on-gray, hardcoded raw hex colors scattered in components |
| 7 | Animation & Motion | MEDIUM | Context-aware timing (150–300ms for micro-interactions), motion conveys spatial continuity, respect `prefers-reduced-motion` | Same slow duration for every transition, animating heavy layout properties (`width`/`height` instead of `transform`/`opacity`) |
| 8 | Forms & Feedback | MEDIUM | Visible persistent labels, inline field validation error near target input, helpful placeholder text, progressive disclosure | Placeholder-only inputs without labels, top-of-page error dumps, overwhelming complex forms upfront |
| 9 | Navigation | HIGH | Predictable back behavior, bottom navigation with ≤5 primary destinations, deep linking support | Overloaded tab bars, broken back-button stack, hidden critical navigation |
| 10 | Charts & Data | MEDIUM | Clear legends, interactive tooltips on touch, high-contrast accessible data series colors, tabular fallback | Relying on subtle hue differences alone to distinguish data series |

## Design System & Stack Recommendations

1. **Modern SaaS & Web Apps**:
   - Component base: Tailwind CSS utility classes + clean component primitives (e.g., shadcn/ui, Radix UI primitives).
   - Typography: Clean neo-grotesque sans-serif (Inter, Geist, Roboto, SF Pro) with clear typographic hierarchy.
   - Spacing: 4px/8px modular spacing grid (`p-2`, `p-4`, `p-6`, `p-8`).
2. **Mobile Web & Android Responsive**:
   - Generous touch targets (min 48dp on mobile).
   - Sticky bottom action bars on mobile viewports for thumb reachability.
   - Safe area padding (`env(safe-area-inset-bottom)`) for navigation bars and gesture insets.
3. **Color Token Architecture**:
   - Define functional tokens: `surface`, `surface-variant`, `on-surface`, `primary`, `primary-container`, `outline`, `error`.
   - Never hardcode raw hex values in individual component files.

## Review & QA Checklist
Before completing an interface:
- [ ] Are all interactive elements accessible via keyboard and screen reader?
- [ ] Does the layout adapt gracefully from 360px mobile width to desktop without horizontal scroll?
- [ ] Are contrast ratios verified against light and dark surfaces?
- [ ] Do button states provide visual feedback for hover, active/pressed, focused, and disabled?
- [ ] Are loading and error states designed for asynchronous data operations?
