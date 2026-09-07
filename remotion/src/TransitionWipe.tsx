import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const transitionWipeSchema = z.object({
  width: z.number().int().min(2).default(3840),
  height: z.number().int().min(2).default(2160),
  durationInSeconds: z.number().min(0.25).default(1),
  mode: z.enum(["wipe", "zoom"]).default("wipe"),
  color: zColor().default("#111111"),
  accentColor: zColor().default("#FFD400"),
});

export type TransitionWipeProps = z.infer<typeof transitionWipeSchema>;

// Overlay transition clip: the frame is FULLY covered at the midpoint, so the
// editor places the cut under the middle of this clip. Everything else is alpha.
export const TransitionWipe: React.FC<TransitionWipeProps> = ({
  mode,
  color,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();

  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (mode === "zoom") {
    // Circle bursts from center, covers the frame at p=0.5, then a hole opens
    // from the center and grows until everything is transparent again.
    const maxRadius = Math.hypot(width, height) / 2;
    const outer = interpolate(progress, [0, 0.5], [0, maxRadius * 1.05], {
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.7, 0, 0.84, 0),
    });
    const inner = interpolate(progress, [0.5, 1], [0, maxRadius * 1.05], {
      extrapolateLeft: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    const accentOuter = interpolate(
      progress,
      [0.06, 0.56],
      [0, maxRadius * 1.05],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.7, 0, 0.84, 0) },
    );
    const accentInner = interpolate(
      progress,
      [0.44, 0.94],
      [0, maxRadius * 1.05],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) },
    );

    return (
      <AbsoluteFill>
        <svg width={width} height={height}>
          {/* Accent ring slightly behind the main one */}
          <circle
            cx={width / 2}
            cy={height / 2}
            r={Math.max(0, (accentOuter + accentInner) / 2)}
            fill="none"
            stroke={accentColor}
            strokeWidth={Math.max(0, accentOuter - accentInner)}
          />
          <circle
            cx={width / 2}
            cy={height / 2}
            r={Math.max(0, (outer + inner) / 2)}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(0, outer - inner)}
          />
        </svg>
      </AbsoluteFill>
    );
  }

  // Diagonal wipe: skewed panels sweep left -> right. Main panel is wide
  // enough (200% + skew) to fully cover the frame at p=0.5.
  const ease = Easing.bezier(0.65, 0, 0.35, 1);
  const mainX = interpolate(progress, [0, 1], [-250, 250], { easing: ease });
  const accentX = interpolate(progress, [0, 1], [-280, 220], { easing: ease });

  const panel = (translate: number, bg: string, w: string): React.CSSProperties => ({
    position: "absolute",
    top: "-25%",
    left: "-50%",
    width: w,
    height: "150%",
    background: bg,
    transform: `translateX(${translate}%) skewX(-12deg)`,
  });

  return (
    <AbsoluteFill>
      <div style={panel(accentX, accentColor, "210%")} />
      <div style={panel(mainX, color, "200%")} />
    </AbsoluteFill>
  );
};
