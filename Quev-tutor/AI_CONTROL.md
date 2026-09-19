# Safe AI motion controls

The Professor is controlled through named gestures plus an optional `tweak` object. The AI is never given raw SVG, selector, transform, or CSS access.

```json
{
  "do": "explain",
  "say": "A planet stays in orbit because gravity continually bends its path.",
  "tweak": {
    "headTilt": -8,
    "look": { "x": -0.5, "y": -0.2 },
    "smile": 1.2
  },
  "hold": 0.5
}
```

Supported safe controls:

| Control | Range | Meaning |
| --- | --- | --- |
| `headTilt` | -18 to 18 | Head rotation in degrees |
| `lean` | -8 to 8 | Gentle torso rotation |
| `leftArm` | -20 to 170 | Left arm pose |
| `rightArm` | -20 to 175 | Right arm pose |
| `bounce` | -36 to 0 | Small upward body movement |
| `look.x`, `look.y` | -1 to 1 | Pupil direction |
| `smile` | 0.65 to 1.45 | Smile intensity; skipped while speech owns the mouth |

Use a `tweak` for a small accent, not to replace a gesture. Avoid setting an arm or head tweak at the same time as a gesture that uses that body part. Values outside these ranges are clamped. Every tweak returns automatically to the neutral pose after its optional `hold`, and the director resets the complete rig to idle after each performance.
