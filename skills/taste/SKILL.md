---
name: design-taste-frontend
description: "Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check."
license: MIT
source: https://github.com/Leonxlnx/taste-skill
revision: b17742737e796305d829b3ad39eda3add0d79060
---

# Taste: Anti-Slop Frontend Skill (v2 Frontend)

Landing pages, portfolios, product showcases, and distinctive web applications. Designed to prevent generic, templated LLM design patterns.

Upstream Attribution: Created by Leon Lin (Leonxlnx). Licensed under the MIT License.
Upstream Repository: https://github.com/Leonxlnx/taste-skill (revision `b17742737e796305d829b3ad39eda3add0d79060`).

---

## 0. Brief Inference & Anti-Default Discipline

Before generating code or selecting styles, infer what the user actually wants:
1. **Page Kind:** Landing (SaaS / consumer / studio / event), portfolio, product showcase, redesign.
2. **Vibe Words:** "Minimalist", "editorial", "Linear-style", "brutalist", "playful", "premium consumer", "glassy", "dark tech".
3. **Target Audience:** Technical buyers vs. design-conscious consumers vs. hiring managers. The audience picks the aesthetic.
4. **Anti-Default Discipline:**
   - Avoid generic AI-purple gradients on dark backgrounds.
   - Avoid generic 3-equal feature cards centered below an empty hero.
   - Avoid Inter + slate-900 on everything without intention.
   - Choose distinctive, deliberate typography, asymmetric layout moments, and purposeful density.

## 1. The Three Core Dials

Calibrate the interface using three design dials:
- **`DESIGN_VARIANCE` (1–10):** 1 = strict corporate symmetry, 10 = artsy chaos / dynamic asymmetry. (Default: 7–8)
- **`MOTION_INTENSITY` (1–10):** 1 = completely static, 10 = cinematic physics / scroll-driven animation. (Default: 5–6)
- **`VISUAL_DENSITY` (1–10):** 1 = airy art gallery, 10 = dense cockpit / packed data. (Default: 3–4 for marketing, 7 for dev tools)

### Presets by Product Type
- **Modern SaaS Landing:** Variance 7, Motion 6, Density 4. (Clean utilities, crisp borders, subtle glows, responsive layout).
- **Creative / Studio Portfolio:** Variance 9, Motion 7, Density 3. (Expressive typography, asymmetric layouts, editorial spacing).
- **Developer / Tooling Landing:** Variance 6, Motion 4, Density 5. (Monospace accents, code previews, high readability).
- **Consumer Brand:** Variance 8, Motion 6, Density 3. (Warm palette, tactile cards, subtle spring physics).

## 2. Typography & Visual Originality

1. **Type Pairing Strategy:**
   - Pair an expressive display face (editorial serif, geometric display, or grotesque) for headings with an ultra-legible neutral sans-serif for body text.
   - Scale contrast: Make headline sizes boldly distinct (`text-4xl` / `text-6xl`) from body copy (`text-base`).
2. **Layout Experimentation:**
   - Break out of rigid grid boxes with offset headers, overlapping elements, or full-bleed accent strips.
   - Generous breathing room: Use `py-20` to `py-32` between distinct marketing sections.
3. **Surface & Depth:**
   - Use subtle borders (`border-border/40`) and soft backdrop blurs instead of heavy drop shadows.
   - Differentiate cards with subtle border gradients or light highlights rather than flat gray rectangles.

## 3. Pre-Flight Quality Check
- [ ] Does this look like a customized product rather than a generic boilerplate template?
- [ ] Are font sizes and weights balanced with sufficient visual hierarchy?
- [ ] Is spacing deliberate and breathing room generous across screen widths?
- [ ] Does motion enhance understanding rather than distract or cause layout shifts?
