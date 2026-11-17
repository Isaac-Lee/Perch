# thinking-orbs 0.3.2 (MIT, React, canvas 2D)

- `import { ThinkingOrb } from "thinking-orbs"` is the only component. It renders a `<canvas>`, so `className` and `style` pass through.
- Props: `state` (`working` | `searching` | `solving` | `listening` | `connecting` | `weaving` | `composing` | `breathing` | `shaping`), `size` (`64` | `32` | `20`), `theme` (`auto` | `dark` | `light`), `speed` (number, default 1), `paused` (boolean), `aria-label`.
- Pane header: `<ThinkingOrb state="working" size={20} theme="dark" />`. Footer loader: `<ThinkingOrb state="composing" size={20} theme="dark" />`. Always pin `theme="dark"`.
- It pauses by itself when offscreen or the tab is hidden, and shows a static frame under `prefers-reduced-motion`.
