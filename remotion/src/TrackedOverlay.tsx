import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

// Track JSON: {fps, boxes: [{t, x, y, w, h}]} — `t` in frames of the TRACK's
// own fps; x/y/w/h normalized 0-1 (x/y = top-left corner). Boxes are
// interpolated linearly between keyframes.
export const trackedOverlaySchema = z.object({
  track: z.object({
    fps: z.number().min(1),
    boxes: z
      .array(
        z.object({
          t: z.number().min(0),
          x: z.number(),
          y: z.number(),
          w: z.number().min(0),
          h: z.number().min(0),
        }),
      )
      .min(1),
  }),
  width: z.number().int().min(2).default(3840),
  height: z.number().int().min(2).default(2160),
  // Optional image placed inside the tracked box (absolute file path,
  // http(s) URL or data: URI). Empty string = draw a styled box instead.
  src: z.string().default(""),
  label: z.string().default(""),
  borderColor: zColor().default("#FFD400"),
  borderWidthPx: z.number().min(0).default(8),
  cornerRadiusPx: z.number().min(0).default(16),
  fillOpacity: z.number().min(0).max(1).default(0),
});

export type TrackedOverlayProps = z.infer<typeof trackedOverlaySchema>;

const resolveSrc = (src: string): string => {
  if (/^(https?:|data:|file:)/.test(src)) {
    return src;
  }
  // Absolute local path -> file URL (works in the render browser).
  return `file://${encodeURI(src)}`;
};

export const TrackedOverlay: React.FC<TrackedOverlayProps> = ({
  track,
  width,
  height,
  src,
  label,
  borderColor,
  borderWidthPx,
  cornerRadiusPx,
  fillOpacity,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Current time in TRACK frames (track fps may differ from composition fps).
  const trackT = (frame / fps) * track.fps;

  const boxes = [...track.boxes].sort((a, b) => a.t - b.t);
  // interpolate() needs strictly increasing input — dedupe identical t.
  const deduped = boxes.filter((b, i) => i === 0 || b.t > boxes[i - 1].t);

  const ts = deduped.map((b) => b.t);
  const opts = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;

  const one = deduped.length === 1;
  const x = one ? deduped[0].x : interpolate(trackT, ts, deduped.map((b) => b.x), opts);
  const y = one ? deduped[0].y : interpolate(trackT, ts, deduped.map((b) => b.y), opts);
  const w = one ? deduped[0].w : interpolate(trackT, ts, deduped.map((b) => b.w), opts);
  const h = one ? deduped[0].h : interpolate(trackT, ts, deduped.map((b) => b.h), opts);

  const px = x * width;
  const py = y * height;
  const pw = w * width;
  const ph = h * height;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: px,
          top: py,
          width: pw,
          height: ph,
        }}
      >
        {src ? (
          <Img
            src={resolveSrc(src)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              border: `${borderWidthPx}px solid ${borderColor}`,
              borderRadius: cornerRadiusPx,
              background: `rgba(255, 255, 255, ${fillOpacity})`,
              boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
            }}
          />
        )}
        {label ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: -height * 0.02 - height * 0.03,
              padding: `${height * 0.006}px ${height * 0.012}px`,
              background: borderColor,
              color: "#111111",
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
              fontWeight: 800,
              fontSize: height * 0.022,
              borderRadius: cornerRadiusPx * 0.5,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
