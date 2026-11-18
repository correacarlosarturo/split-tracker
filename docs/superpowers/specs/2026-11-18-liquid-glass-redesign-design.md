# Liquid Glass redesign — design

Date: 2026-11-18 · Status: approved in conversation

## Intent

The owner compared three style mockups (Liquid Glass, One UI, Material) and chose Liquid Glass: "I really like it much more." It replaces the current look as the app's only design. It does not sit behind an experimental switch. The README is rebuilt in the same style, because today it reads as generic: a grid of screenshots with little around them.

## Goals

- Restyle every screen (Stats, Log, Plan, Coach, Settings, toasts) in the Liquid Glass look from the approved mockup:
  - a soft colour wash tinted by the accent behind everything
  - frosted, translucent cards with a bright top edge
  - a floating pill tab bar
  - large titles and fully rounded buttons
- Keep the exercise animations (each card's start and end photos cross-fading). Present them inside a glass frame.
- Keep the Auto/Light/Dark/Black modes, the five accent colours and the high-contrast option.
- Rebuild the README around rendered images of the real app on a phone frame I draw myself (option A: static images, no GIF).

## Non-goals

- No change to layout structure, tab order, features, data or sync behaviour.
- No One UI or Material styles; both are scrapped.
- No animated README media.

## Anti-goals

- Text that is hard to read on glass, especially in bright light. Contrast must hold in every mode.
- Lag or battery drain from blur. The large surfaces get the blur; per-element blur on long lists is avoided.
- Platform logos, Apple's device artwork or Apple's fonts. The phone frame is drawn from scratch, and the system font is used.

## Constraints

- The app is one static PWA. The styles live in `src/template.html` and the markup in `src/app.js`. It is built by `src/build.py`.
- The content security policy stays strict: no inline script. Inline style attributes are already allowed.
- `backdrop-filter` needs the `-webkit-` prefix on iOS Safari.
- `prefers-reduced-motion` must still stop the animation cross-fade, and tapping still toggles start/end.
- GitHub READMEs strip CSS, so the README's look comes only from images plus a markdown structure.

## Approaches considered

- **Restyle the existing screens via CSS (chosen).** It keeps the markup and behaviour, so the tests stay valid and the risk is lowest.
- **Rebuild the screens.** Unneeded, because the structure already matches the mockup, and it risks regressions.
- **README option A (chosen) vs B.** Option A is static framed images. Option B would add a GIF of the animation: rejected by the owner, and heavy and grainy.

## Decided in conversation

- Liquid Glass only, as the default and only look.
- The modes, accents and high contrast carry over. High contrast makes the glass solid.
- The Stats tab shows a preview of the next session's first lift, animated.
- README option A.
- Design and code are done in the main session. A separate agent does a security review of the finished diff.

## Left to the builder

- Exact token values per mode and accent, blur radii, and the colour-wash composition.
- README section order and copy, keeping the existing factual content (install, sync setup, data layout, backup, develop, privacy, licence).
- How the README images are produced. The intent is a script that renders the built app with demo data in a headless browser and frames it, so the images can be regenerated.
