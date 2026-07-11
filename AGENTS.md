# Jarvis UI Design Brief

## Product Intent

Jarvis is a command center, not a landing page. Build the usable cockpit first: mode switching, command input, live state, visual feedback, and task execution should always be visible within the first viewport.

## Visual Direction

- Premium cinematic interface with restrained density: dark glass, fine linework, real imagery, sharp telemetry, and small moments of motion.
- Avoid generic AI gradients, floating blob decorations, mascot art, oversized empty hero copy, and stock SaaS card walls.
- Use a mixed palette, not one-note blue: cyan for system intelligence, amber for caution/action, green for healthy state, red only for risk.
- Use crisp typography from the system stack unless a local licensed font is added. Do not import random web fonts without approval.
- Keep border radii at 8px or less. Panels should feel machined, not bubbly.
- Use full-viewport imagery or Three.js for atmosphere. Do not hide the primary visual in a decorative preview card.

## Interaction Principles

- Every visible control must do something.
- Every mode must change layout, copy, and useful controls, not only the heading.
- Voice, camera, screen, and API features must show permission/error states clearly.
- A feature requiring external credentials must still have a functional setup/test path and explain exactly what credential is missing inside the app.
- Prefer direct manipulation: toggles, segmented mode controls, sliders, command chips, live task rows, and visual progress over instructional paragraphs.

## Responsive Rules

- Desktop: side rail plus multi-column command surface.
- Tablet: rail becomes compact, panels reorganize without overlap.
- Mobile: all primary controls must fit without horizontal body scroll; mode controls may compress but must remain tappable.

## Accessibility

- Buttons and inputs need labels.
- Do not rely on color alone for risk or state.
- Motion-heavy boot and mode transitions must complete quickly and not block the app permanently.
