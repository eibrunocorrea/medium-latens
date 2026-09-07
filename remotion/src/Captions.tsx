import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { createTikTokStyleCaptions } from "@remotion/captions";
import type { Caption, TikTokPage } from "@remotion/captions";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

// Word shape = flattened `segments[].words[]` of our whisper JSON
// (USER_DIR/workspaces/*/transcript/*.whisper.json): seconds, leading
// space already included in `word`.
export const captionsSchema = z.object({
  words: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      word: z.string(),
    }),
  ),
  width: z.number().int().min(2).default(2160),
  height: z.number().int().min(2).default(3840),
  // Subtracted from every start/end. Use it to render a clip that does not
  // begin at 0s of the source video (pass e.g. 11.3 to start there).
  timeOffsetSeconds: z.number().default(0),
  // Extra transparent tail after the last word, in seconds.
  tailSeconds: z.number().min(0).default(0.5),
  fontSize: z.number().min(8).default(140),
  textColor: zColor().default("#FFFFFF"),
  highlightColor: zColor().default("#FFD400"),
  strokeColor: zColor().default("#000000"),
  // How often pages switch. Lower = closer to word-by-word.
  combineTokensWithinMilliseconds: z.number().min(100).default(1000),
  // Baseline of the caption block, as a fraction of height from the top.
  // 0.82 keeps it inside the bottom safe-area of vertical shorts.
  baselineY: z.number().min(0).max(1).default(0.82),
});

export type CaptionsProps = z.infer<typeof captionsSchema>;

const CaptionPage: React.FC<{
  page: TikTokPage;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  strokeColor: string;
  baselineY: number;
}> = ({ page, fontSize, textColor, highlightColor, strokeColor, baselineY }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Time relative to the sequence start, converted to absolute ms.
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "5%",
          width: "90%",
          top: `${baselineY * 100}%`,
          transform: "translateY(-100%)",
          textAlign: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
          fontWeight: 900,
          fontSize,
          lineHeight: 1.15,
          whiteSpace: "pre-wrap",
          WebkitTextStroke: `${Math.max(2, fontSize * 0.045)}px ${strokeColor}`,
          paintOrder: "stroke fill",
          textShadow: `0 ${fontSize * 0.05}px ${fontSize * 0.12}px rgba(0,0,0,0.55)`,
        }}
      >
        {page.tokens.map((token) => {
          const isActive =
            token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;

          const tokenStartFrame = ((token.fromMs - page.startMs) / 1000) * fps;
          const pop = spring({
            frame: frame - tokenStartFrame,
            fps,
            config: { damping: 200 },
            durationInFrames: Math.round(fps * 0.25),
          });
          const scale = isActive ? interpolate(pop, [0, 1], [0.85, 1.08]) : 1;

          return (
            <span
              key={token.fromMs}
              style={{
                display: "inline-block",
                whiteSpace: "pre",
                color: isActive ? highlightColor : textColor,
                transform: `scale(${scale})`,
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Captions: React.FC<CaptionsProps> = ({
  words,
  timeOffsetSeconds,
  fontSize,
  textColor,
  highlightColor,
  strokeColor,
  combineTokensWithinMilliseconds,
  baselineY,
}) => {
  const { fps } = useVideoConfig();

  const captions: Caption[] = useMemo(() => {
    return words
      .filter((w) => w.end > timeOffsetSeconds)
      .map((w) => {
        const startMs = Math.max(0, (w.start - timeOffsetSeconds) * 1000);
        const endMs = Math.max(startMs + 1, (w.end - timeOffsetSeconds) * 1000);
        // Ensure a leading space so tokens don't glue together
        // (whitespace-sensitive, see display-captions.md).
        const text = w.word.startsWith(" ") ? w.word : ` ${w.word}`;
        return {
          text,
          startMs,
          endMs,
          timestampMs: (startMs + endMs) / 2,
          confidence: null,
        };
      });
  }, [words, timeOffsetSeconds]);

  const { pages } = useMemo(() => {
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds,
    });
  }, [captions, combineTokensWithinMilliseconds]);

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        // Hold the page 300ms past its last word (prevents flicker between
        // pages of the same sentence), but never overlap the next page.
        const endFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * fps : Infinity,
          startFrame + ((page.durationMs + 300) / 1000) * fps,
        );
        const durationInFrames = endFrame - startFrame;
        if (durationInFrames <= 0) {
          return null;
        }
        return (
          <Sequence
            key={index}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <CaptionPage
              page={page}
              fontSize={fontSize}
              textColor={textColor}
              highlightColor={highlightColor}
              strokeColor={strokeColor}
              baselineY={baselineY}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
