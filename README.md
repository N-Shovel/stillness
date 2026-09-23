# Stillness

A quiet mountain lake to rest your eyes and mind.

**Live:** https://stillness-sage.vercel.app

Stillness is a calm, animated scene drawn on a `<canvas>`: mountains, a reflective lake, drifting clouds, birds by day and fireflies and stars by night. It follows your local time, or you can let the day drift by. Optional ambient sound is fully synthesized in the browser with the Web Audio API, and a breathing guide helps you slow down.

## Features

- **Time of day:** Dawn, Day, Dusk and Night, or *Live* (follows your clock) and *Flow* (the day passes slowly).
- **Ambient sound:** distant water, wind and gentle lapping at the shore, generated live. No audio files.
- **Breathing guide:** a slow, expanding ring to breathe along with.
- **Quiet interface:** controls fade away when you're still, and you can hide them entirely.
- **Whispers:** short, gentle phrases that come and go.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `S` | Toggle sound |
| `B` | Toggle breathing guide |
| `H` | Hide or show the interface |
| `F` | Toggle fullscreen |

When the interface is hidden, click anywhere to bring it back.

## Running locally

This is a static site with no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Project structure

```
index.html   page markup and controls
style.css    layout, dock and overlay styles
main.js      scene rendering, palettes, audio and interactions
```

## Deployment

Deployed on [Vercel](https://vercel.com) at https://stillness-sage.vercel.app as a static site. No configuration is needed; Vercel serves the folder as-is.

## License

[MIT](LICENSE)
