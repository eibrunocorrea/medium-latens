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
import {
  captionPresets,
  captionPresetNames,
  CaptionPreset,
} from "./caption-presets";

// Preset-driven captions. Same word shape as Captions (flattened
// `segments[].words[]` of our whisper JSON, seconds), but all styling,
// grouping and animation come from a named preset (src/caption-presets.ts).
export const captionsProSchema = z.object({
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
  // begin at 0s of the source video (pass e.g. 40 to start there).
  timeOffsetSeconds: z.number().default(0),
  // Extra transparent tail after the last word, in seconds.
  tailSeconds: z.number().min(0).default(0.5),
  preset: z.enum(captionPresetNames).default("shorts"),
});

export type CaptionsProProps = z.infer<typeof captionsProSchema>;

// Hard-cap words per page (createTikTokStyleCaptions only groups by time).
// Chunks keep the original absolute token times, so highlight logic and the
// page hold below work unchanged.
const capWordsPerPage = (
  pages: TikTokPage[],
  maxWords: number | null,
): TikTokPage[] => {
  if (maxWords === null) {
    return pages;
  }
  return pages.flatMap((page) => {
    if (page.tokens.length <= maxWords) {
      return [page];
    }
    const chunks: TikTokPage[] = [];
    for (let i = 0; i < page.tokens.length; i += maxWords) {
      const tokens = page.tokens.slice(i, i + maxWords);
      const startMs = tokens[0].fromMs;
      chunks.push({
        text: tokens.map((t) => t.text).join(""),
        startMs,
        durationMs: tokens[tokens.length - 1].toMs - startMs,
        tokens,
      });
    }
    return chunks;
  });
};

const CaptionsProPage: React.FC<{
  page: TikTokPage;
  preset: CaptionPreset;
}> = ({ page, preset }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Time relative to the sequence start, converted to absolute ms.
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;

  const strokeWidth = preset.strokeWidthFactor * preset.fontSize;

  const text = (
    <div
      style={{
        display: preset.box ? "inline-block" : "block",
        fontFamily: preset.fontFamily,
        fontWeight: preset.fontWeight,
        fontSize: preset.fontSize,
        textTransform: preset.textTransform,
        lineHeight: 1.15,
        whiteSpace: "pre-wrap",
        wordSpacing: preset.wordSpacingFactor * preset.fontSize,
        ...(strokeWidth > 0
          ? {
              WebkitTextStroke: `${strokeWidth}px ${preset.strokeColor}`,
              paintOrder: "stroke fill" as const,
            }
          : {}),
        ...(preset.shadow
          ? {
              textShadow: `0 ${preset.fontSize * 0.05}px ${
                preset.fontSize * 0.12
              }px rgba(0,0,0,0.55)`,
            }
          : {}),
        ...(preset.box
          ? {
              background: preset.box.background,
              padding: `${preset.box.paddingYFactor * preset.fontSize}px ${
                preset.box.paddingXFactor * preset.fontSize
              }px`,
              borderRadius: preset.box.borderRadiusFactor * preset.fontSize,
            }
          : {}),
      }}
    >
      {page.tokens.map((token) => {
        const isActive =
          token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;

        let scale = 1;
        if (isActive && preset.animation !== "none") {
          const tokenStartFrame = ((token.fromMs - page.startMs) / 1000) * fps;
          const pop = spring({
            frame: frame - tokenStartFrame,
            fps,
            config:
              preset.animation === "pop"
                ? { damping: 12, stiffness: 200, mass: 0.6 }
                : { damping: 200 },
            durationInFrames: Math.round(fps * 0.25),
          });
          scale = interpolate(pop, [0, 1], [0.85, preset.activeScale]);
        }

        // Keep leading whitespace outside the scaled span, otherwise the
        // active-word scale visually swallows the gap between words
        // (noticeable on big presets like "shorts").
        const leading = token.text.match(/^\s*/)?.[0] ?? "";
        const body = token.text.slice(leading.length);

        return (
          <React.Fragment key={token.fromMs}>
            {leading}
            <span
              style={{
                display: "inline-block",
                whiteSpace: "pre",
                color: isActive ? preset.highlightColor : preset.textColor,
                transform: `scale(${scale})`,
              }}
            >
              {body}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "5%",
          width: "90%",
          top: `${preset.baselineY * 100}%`,
          transform: "translateY(-100%)",
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const CaptionsPro: React.FC<CaptionsProProps> = ({
  words,
  timeOffsetSeconds,
  preset: presetName,
}) => {
  const { fps } = useVideoConfig();
  const preset = captionPresets[presetName];

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

  const pages = useMemo(() => {
    const { pages: rawPages } = createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: preset.combineTokensWithinMilliseconds,
    });
    return capWordsPerPage(rawPages, preset.maxWordsPerPage);
  }, [captions, preset]);

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
            <CaptionsProPage page={page} preset={preset} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
