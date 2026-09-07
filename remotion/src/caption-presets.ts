// Named caption presets for CaptionsPro. Each preset fully describes the look
// (font/size/colors), position, page grouping (ms + optional word cap) and the
// active-word animation. Add a new preset here + to `captionPresetNames` and it
// becomes selectable via the `preset` prop with zero component changes.

export type CaptionAnimationKind = "pop" | "scale" | "none";

export type CaptionBoxStyle = {
  background: string;
  // Padding / radius as a fraction of fontSize so presets scale with size.
  paddingXFactor: number;
  paddingYFactor: number;
  borderRadiusFactor: number;
};

export type CaptionPreset = {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  textTransform: "none" | "uppercase";
  textColor: string;
  // Color of the currently spoken word. Equal to textColor = no color
  // highlight (animation only), as in "clean".
  highlightColor: string;
  strokeColor: string;
  // WebkitTextStroke width as a fraction of fontSize. 0 = no stroke.
  strokeWidthFactor: number;
  shadow: boolean;
  // Rounded box behind the caption block. null = bare text.
  box: CaptionBoxStyle | null;
  // Baseline of the block, fraction of height from the top (like Captions).
  baselineY: number;
  // Passed to createTikTokStyleCaptions — lower = closer to word-by-word.
  combineTokensWithinMilliseconds: number;
  // Hard cap of words per page, applied after page creation. null = no cap.
  maxWordsPerPage: number | null;
  // Active-word animation: "pop" = spring overshoot, "scale" = subtle grow,
  // "none" = color change only.
  animation: CaptionAnimationKind;
  // Scale of the active word at animation peak (1 = no growth).
  activeScale: number;
  // Extra CSS word-spacing as a fraction of fontSize. Reserves room so the
  // scaled active word never swallows the gap to its neighbours (matters on
  // big sizes + springy pops).
  wordSpacingFactor: number;
};

export const captionPresets = {
  // MKBHD-style review captions: heavy white type, yellow active word,
  // no box, resting at the bottom. Calm — subtle grow, no overshoot.
  mkbhd: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
    fontWeight: 900,
    fontSize: 150,
    textTransform: "none",
    textColor: "#FFFFFF",
    highlightColor: "#FFD400",
    strokeColor: "#000000",
    strokeWidthFactor: 0,
    shadow: true,
    box: null,
    baselineY: 0.85,
    combineTokensWithinMilliseconds: 1200,
    maxWordsPerPage: null,
    animation: "scale",
    activeScale: 1.06,
    wordSpacingFactor: 0.05,
  },
  // High-energy: uppercase text inside a dark rounded box, green active
  // word with a springy pop.
  hype: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
    fontWeight: 800,
    fontSize: 130,
    textTransform: "uppercase",
    textColor: "#FFFFFF",
    highlightColor: "#00E676",
    strokeColor: "#000000",
    strokeWidthFactor: 0,
    shadow: false,
    box: {
      background: "rgba(17, 17, 17, 0.85)",
      paddingXFactor: 0.45,
      paddingYFactor: 0.22,
      borderRadiusFactor: 0.28,
    },
    baselineY: 0.82,
    combineTokensWithinMilliseconds: 800,
    maxWordsPerPage: null,
    animation: "pop",
    activeScale: 1.12,
    wordSpacingFactor: 0.2,
  },
  // Minimal: medium weight, no color highlight — the spoken word only
  // grows slightly. For footage where captions must not shout.
  clean: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
    fontWeight: 600,
    fontSize: 110,
    textTransform: "none",
    textColor: "#FFFFFF",
    highlightColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidthFactor: 0,
    shadow: true,
    box: null,
    baselineY: 0.82,
    combineTokensWithinMilliseconds: 1500,
    maxWordsPerPage: null,
    animation: "scale",
    activeScale: 1.05,
    wordSpacingFactor: 0,
  },
  // Vertical shorts: HUGE uppercase type at center-low, max 2 words per
  // page, yellow active word with a strong black stroke and a pop.
  shorts: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
    fontWeight: 900,
    fontSize: 210,
    textTransform: "uppercase",
    textColor: "#FFFFFF",
    highlightColor: "#FFD400",
    strokeColor: "#000000",
    strokeWidthFactor: 0.06,
    shadow: true,
    box: null,
    baselineY: 0.68,
    combineTokensWithinMilliseconds: 3000,
    maxWordsPerPage: 2,
    animation: "pop",
    activeScale: 1.1,
    wordSpacingFactor: 0.3,
  },
} as const satisfies Record<string, CaptionPreset>;

export type CaptionPresetName = keyof typeof captionPresets;

export const captionPresetNames = Object.keys(
  captionPresets,
) as [CaptionPresetName, ...CaptionPresetName[]];
