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

export const lowerThirdSchema = z.object({
  name: z.string().default("Bruno Correa"),
  subtitle: z.string().default("MetaCards"),
  width: z.number().int().min(2).default(3840),
  height: z.number().int().min(2).default(2160),
  durationInSeconds: z.number().min(1).default(5),
  accentColor: zColor().default("#FFD400"),
  textColor: zColor().default("#FFFFFF"),
  barColor: zColor().default("#111111"),
  // Position of the block, fraction of frame from left / from top.
  x: z.number().min(0).max(1).default(0.06),
  y: z.number().min(0).max(1).default(0.78),
  scale: z.number().min(0.1).default(1),
});

export type LowerThirdProps = z.infer<typeof lowerThirdSchema>;

export const LowerThird: React.FC<LowerThirdProps> = ({
  name,
  subtitle,
  height,
  accentColor,
  textColor,
  barColor,
  x,
  y,
  scale,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const outDur = Math.round(fps * 0.4);
  const outStart = durationInFrames - outDur;

  // Enter: accent bar grows, then panel slides out of it, then texts rise.
  const barIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.4) });
  const panelIn = spring({
    frame: frame - Math.round(fps * 0.15),
    fps,
    config: { damping: 22, mass: 0.9 },
    durationInFrames: Math.round(fps * 0.6),
  });
  const nameIn = spring({
    frame: frame - Math.round(fps * 0.3),
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.4),
  });
  const subIn = spring({
    frame: frame - Math.round(fps * 0.45),
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.4),
  });

  // Exit: whole block slides left and fades.
  const out = interpolate(frame, [outStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.5, 0, 0.75, 0),
  });

  const fontBase = height * 0.037 * scale;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          display: "flex",
          alignItems: "stretch",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
          transform: `translateX(${out * -8}%)`,
          opacity: 1 - out,
        }}
      >
        <div
          style={{
            width: fontBase * 0.35,
            background: accentColor,
            transform: `scaleY(${barIn})`,
            transformOrigin: "bottom",
            borderRadius: fontBase * 0.1,
          }}
        />
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              background: barColor,
              padding: `${fontBase * 0.45}px ${fontBase * 0.9}px`,
              borderRadius: `0 ${fontBase * 0.25}px ${fontBase * 0.25}px 0`,
              transform: `translateX(${interpolate(panelIn, [0, 1], [-100, 0])}%)`,
              boxShadow: `0 ${fontBase * 0.15}px ${fontBase * 0.5}px rgba(0,0,0,0.4)`,
            }}
          >
            <div style={{ overflow: "hidden" }}>
              <div
                style={{
                  color: textColor,
                  fontSize: fontBase * 1.35,
                  fontWeight: 800,
                  lineHeight: 1.15,
                  transform: `translateY(${interpolate(nameIn, [0, 1], [110, 0])}%)`,
                }}
              >
                {name}
              </div>
            </div>
            <div style={{ overflow: "hidden" }}>
              <div
                style={{
                  color: accentColor,
                  fontSize: fontBase * 0.8,
                  fontWeight: 600,
                  letterSpacing: fontBase * 0.04,
                  textTransform: "uppercase",
                  marginTop: fontBase * 0.15,
                  transform: `translateY(${interpolate(subIn, [0, 1], [120, 0])}%)`,
                }}
              >
                {subtitle}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
