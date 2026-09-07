import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const textAnimSchema = z.object({
  text: z.string().default("MEDIUM LATENS"),
  width: z.number().int().min(2).default(3840),
  height: z.number().int().min(2).default(2160),
  durationInSeconds: z.number().min(0.5).default(3),
  fontSize: z.number().min(8).default(260),
  color: zColor().default("#FFFFFF"),
  accentColor: zColor().default("#FFD400"),
  strokeColor: zColor().default("#000000"),
  // Vertical center of the text block, fraction of frame height.
  y: z.number().min(0).max(1).default(0.5),
});

export type TextAnimProps = z.infer<typeof textAnimSchema>;

export const TextAnim: React.FC<TextAnimProps> = ({
  text,
  durationInSeconds,
  fontSize,
  color,
  accentColor,
  strokeColor,
  y,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const words = text.split(" ").filter((w) => w.length > 0);
  const staggerFrames = Math.round(fps * 0.08);

  const outDur = Math.round(fps * 0.35);
  const outStart = Math.max(0, durationInFrames - outDur);
  const out = interpolate(frame, [outStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.5, 0, 0.75, 0),
  });

  // Underline sweeps in after the words have landed.
  const underline = spring({
    frame: frame - (words.length * staggerFrames + Math.round(fps * 0.25)),
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.4),
  });

  void durationInSeconds; // duration is applied via calculateMetadata in Root

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "5%",
          width: "90%",
          top: `${y * 100}%`,
          transform: `translateY(-50%) scale(${1 - out * 0.1})`,
          opacity: 1 - out,
          textAlign: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
          fontWeight: 900,
          fontSize,
          lineHeight: 1.1,
          color,
          WebkitTextStroke: `${Math.max(2, fontSize * 0.035)}px ${strokeColor}`,
          paintOrder: "stroke fill",
          textShadow: `0 ${fontSize * 0.04}px ${fontSize * 0.1}px rgba(0,0,0,0.5)`,
        }}
      >
        <div>
          {words.map((word, i) => {
            const enter = spring({
              frame: frame - i * staggerFrames,
              fps,
              config: { damping: 16, mass: 0.8 },
              durationInFrames: Math.round(fps * 0.6),
            });
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  whiteSpace: "pre",
                  opacity: interpolate(enter, [0, 0.4], [0, 1], {
                    extrapolateRight: "clamp",
                  }),
                  transform: `translateY(${interpolate(enter, [0, 1], [fontSize * 0.6, 0])}px) rotate(${interpolate(enter, [0, 1], [4, 0])}deg)`,
                }}
              >
                {word}
                {i < words.length - 1 ? " " : ""}
              </span>
            );
          })}
        </div>
        <div
          style={{
            margin: `${fontSize * 0.15}px auto 0`,
            height: fontSize * 0.08,
            width: `${underline * 45}%`,
            background: accentColor,
            borderRadius: fontSize * 0.04,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
