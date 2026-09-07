# Remotion Overlays — Medium Latens

Renders transparent overlays (ProRes 4444 **with alpha**) to import on top of footage in Premiere.
Remotion 4.0.499, React 19, fps fixed at 30. `remotion.config.ts` already defaults to
`prores/4444/yuva444p10le/png`, but the explicit flags below always work.

```bash
cd "remotion"
npm install   # once
```

All compositions are parameterized via `--props=<file.json>` (Zod-validated).
`width`/`height` in the props resize the canvas (4K vertical `2160x3840` or horizontal `3840x2160`).
Duration is computed automatically from the props (words / `durationInSeconds` / track).

Common render flags (append to every command):

```
--codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png
```

> ffprobe note: ProRes 4444 alpha always *decodes* as `pix_fmt=yuva444p12le` (codec is 12-bit
> internally). `yuva444p10le` is the encoder input. Alpha is present when pix_fmt starts with `yuva`.

## Captions (word-by-word, whisper words)

Props: `words: [{start, end, word}]` (seconds — flattened `segments[].words[]` of our
`*.whisper.json`), `timeOffsetSeconds` (subtracted from all times, use to start mid-video),
`tailSeconds`, `fontSize`, `highlightColor`, `combineTokensWithinMilliseconds` (lower = more
word-by-word), `baselineY` (0-1, bottom safe-area).

```bash
npx remotion render Captions out/captions.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png \
  --props=props/captions-fx3-2-test.json
```

Example props: `props/captions-fx3-2-test.json` (real FX3-2 words, vertical),
`props/captions-horizontal-example.json`.

## CaptionsPro (word-by-word with named presets)

Same word input as Captions, but all styling/grouping/animation come from a **named preset**
(`src/caption-presets.ts`). Props: `words`, `timeOffsetSeconds`, `tailSeconds`, `width`,
`height`, `preset` — one of:

| Preset | Look | Grouping | Animation |
|---|---|---|---|
| `mkbhd` | bold white, yellow active word, no box, bottom | 1200 ms | subtle scale |
| `hype` | uppercase in dark rounded box, green active word | 800 ms | spring pop |
| `clean` | medium weight, no color highlight | 1500 ms | scale only |
| `shorts` | HUGE uppercase, center-low, yellow + black stroke | max 2 words/page | spring pop |

Render one command per preset — only the props file changes:

```bash
npx remotion render CaptionsPro out/captions-pro-shorts.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png \
  --props=props/captions-pro-shorts-fx3-2.json
npx remotion render CaptionsPro out/captions-pro-mkbhd.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png \
  --props=props/captions-pro-mkbhd-fx3-2.json
# hype / clean: copy a props file and set "preset": "hype" | "clean"
```

Example props (real FX3-2 words, 40–58 s window, vertical):
`props/captions-pro-shorts-fx3-2.json`, `props/captions-pro-mkbhd-fx3-2.json`.
New preset = add an entry to `captionPresets` in `src/caption-presets.ts` (it becomes a valid
`preset` value automatically; each preset defines font/size/colors, box, position, grouping ms,
optional `maxWordsPerPage`, animation and `wordSpacingFactor`).

## LowerThird (name + subtitle in/out)

Props: `name`, `subtitle`, `durationInSeconds`, `accentColor`, `barColor`, `x`, `y` (0-1), `scale`.

```bash
npx remotion render LowerThird out/lower-third.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png \
  --props=props/lower-third-example.json
```

## TextAnim (big title, spring word entrance + underline)

Props: `text`, `durationInSeconds`, `fontSize`, `color`, `accentColor`, `y` (0-1).

```bash
npx remotion render TextAnim out/text-anim.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png \
  --props=props/text-anim-example.json
```

## TransitionWipe (1s transition, frame fully covered at midpoint)

Props: `durationInSeconds`, `mode` (`"wipe"` diagonal panels | `"zoom"` circle burst),
`color`, `accentColor`. Place the cut under the middle of the clip.

```bash
npx remotion render TransitionWipe out/transition.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png
# zoom variant / vertical: --props=props/transition-zoom-example.json
```

## TrackedOverlay (box/image following a track)

Props: `track: {fps, boxes: [{t, x, y, w, h}]}` — `t` in frames of the track's fps, `x/y/w/h`
normalized 0-1 (top-left), linear interpolation between keyframes; `src` (image path/URL, empty =
styled box), `label`, `borderColor`. Duration = last box `t`.

```bash
npx remotion render TrackedOverlay out/tracked.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png \
  --props=props/tracked-overlay-example.json
```

## Measured render times (M-series Mac, 2026-07-25)

| Composition | Frames / size | Wall time |
|---|---|---|
| Captions (2160x3840, 8.3s real FX3-2 words) | 249 frames, 91.3 MB | **22.2s** (~11 fps) |
| CaptionsPro `shorts` (2160x3840, 3s real FX3-2 words) | 90 frames, 33.4 MB | **5.6s** (~16 fps) |
| TransitionWipe (3840x2160, 1s) | 30 frames, 4.2 MB | **3.5s** |

Preview without rendering: `npx remotion studio`.
Quick layout check: `npx remotion still <Comp> /tmp/f.png --frame=30 --scale=0.25 --props=...`.
