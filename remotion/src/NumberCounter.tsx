import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const numberCounterSchema = z.object({
  value: z.number().default(700),
  prefix: z.string().default("R$ "),
  suffix: z.string().default(""),
  // Frames spent counting up from 0 to `value`.
  countFrames: z.number().int().min(4).default(20),
  width: z.number().int().min(2).default(3840),
  height: z.number().int().min(2).default(2160),
  durationInSeconds: z.number().min(0.5).default(2.2),
  fontSize: z.number().min(8).default(300),
  color: zColor().default("#FFFFFF"),
  accentColor: zColor().default("#FFCB05"),
  // Anchor of the number block, fractions of frame size.
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.38),
});

export type NumberCounterProps = z.infer<typeof numberCounterSchema>;

const brl = (n: number) => n.toLocaleString("pt-BR");

export const NumberCounter: React.FC<NumberCounterProps> = ({
  value,
  prefix,
  suffix,
  countFrames,
  fontSize,
  color,
  accentColor,
  x,
  y,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Entrance and exit both come from spring, never linear.
  const enter = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });

  const outDur = Math.round(fps * 0.3);
  const outStart = Math.max(0, durationInFrames - outDur);
  const exit = spring({
    frame: frame - outStart,
    fps,
    config: { damping: 200, mass: 0.5 },
  });
  const leaving = frame >= outStart ? exit : 0;

  // Count 0 -> value, easing out so it decelerates into the final number.
  const raw = interpolate(frame, [0, countFrames], [0, value], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const eased = 1 - Math.pow(1 - raw / Math.max(value, 1), 3);
  const shown = Math.round(eased * value);

  // Bounce lands exactly when the count finishes.
  const bounce = spring({
    frame: frame - countFrames,
    fps,
    config: { damping: 9, mass: 0.45, stiffness: 190 },
  });
  const bounceScale = frame >= countFrames ? 1 + 0.12 * (1 - bounce) : 1;

  const scale = (0.86 + 0.14 * enter) * bounceScale * (1 - 0.25 * leaving);
  const opacity = enter * (1 - leaving);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity,
          display: "flex",
          alignItems: "baseline",
          gap: fontSize * 0.06,
          fontFamily:
            "'Helvetica Neue', Helvetica, 'Segoe UI', Arial, sans-serif",
          fontWeight: 800,
          fontSize,
          color,
          letterSpacing: -fontSize * 0.03,
          textShadow: `0 ${fontSize * 0.03}px ${fontSize * 0.09}px rgba(0,0,0,0.75)`,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: accentColor, fontSize: fontSize * 0.62 }}>
          {prefix}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{brl(shown)}</span>
        {suffix ? (
          <span style={{ color: accentColor, fontSize: fontSize * 0.62 }}>
            {suffix}
          </span>
        ) : null}
      </div>
      {/* underline draws in with the count, accent colour */}
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100 + 6}%`,
          transform: "translateX(-50%)",
          width: interpolate(frame, [2, countFrames + 4], [0, fontSize * 3.4], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          height: Math.max(4, fontSize * 0.035),
          background: accentColor,
          borderRadius: fontSize * 0.02,
          opacity: opacity * 0.95,
        }}
      />
    </AbsoluteFill>
  );
};
