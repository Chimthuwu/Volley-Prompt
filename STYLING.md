# VolleyPrompt Styling Guide

## Palette (CSS vars)
- `--bg: #07050f` deep void, `--card: #120d26`
- Neons: cyan `#00f0ff`, magenta `#ff2a6d`, green `#05ffa1`, purple `#b026ff`
- `--line: rgba(176,38,255,0.3)`, `--line-glow: rgba(176,38,255,0.8)`
- Text `--txt: #e2dfff`, dim `--dim: #8a84b0`

## Typography
- Display: Orbitron (uppercase, letter-spacing 1.5-2px)
- UI: Rajdhani, Mono: Space Mono

## Frameless window
- main.js: `frame: false`, remove menu bar
- Custom `.titlebar` with `-webkit-app-region: drag`, controls `no-drag`
- IPC: window:minimize/maximize/close

## Layout
- `.shell`: flex row, sidebar 240px + main flex:1
- Sidebar: new-action button gradient, history list items with hover glow + translateX

## Background
- `<canvas id="bgCanvas">` fixed z-index -2, animated particles via requestAnimationFrame

## Buttons
- `.big`: gradient cyan→purple, ::after shine sweep on hover, scale 1.02, glow box-shadow
- `.ghost`: transparent, border line, hover cyan glow
- `.newchat`: gradient, uppercase display font

## Animations
- gridPan background, pulseBorder for streaming panels, blink caret, scrollGradientShift
- prefers-reduced-motion disables all

## Hover philosophy
- Panels: border-color glow, translateY(-2px), box-shadow inset
- History items: border cyan, translateX(2px)
- All transitions 0.25-0.3s ease
