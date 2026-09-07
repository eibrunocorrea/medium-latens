import React from "react";
import { Composition } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { Captions, captionsSchema, CaptionsProps } from "./Captions";
import {
  CaptionsPro,
  captionsProSchema,
  CaptionsProProps,
} from "./CaptionsPro";
import { LowerThird, lowerThirdSchema, LowerThirdProps } from "./LowerThird";
import { TextAnim, textAnimSchema, TextAnimProps } from "./TextAnim";
import {
  TransitionWipe,
  transitionWipeSchema,
  TransitionWipeProps,
} from "./TransitionWipe";
import {
  TrackedOverlay,
  trackedOverlaySchema,
  TrackedOverlayProps,
} from "./TrackedOverlay";
import {
  NumberCounter,
  numberCounterSchema,
  NumberCounterProps,
} from "./NumberCounter";

const FPS = 30;

// Every composition defaults to transparent ProRes 4444 output
// (matches remotion.config.ts; kept here too so `--codec` can be omitted).
const alphaDefaults = {
  defaultCodec: "prores",
  defaultVideoImageFormat: "png",
  defaultPixelFormat: "yuva444p10le",
  defaultProResProfile: "4444",
} as const;

const calculateCaptionsMetadata: CalculateMetadataFunction<CaptionsProps> = ({
  props,
}) => {
  const offset = props.timeOffsetSeconds ?? 0;
  const ends = props.words
    .map((w) => w.end - offset)
    .filter((end) => end > 0);
  const lastEnd = ends.length > 0 ? Math.max(...ends) : 1;
  return {
    width: props.width,
    height: props.height,
    durationInFrames: Math.max(
      1,
      Math.ceil((lastEnd + props.tailSeconds) * FPS),
    ),
    ...alphaDefaults,
  };
};

const calculateCaptionsProMetadata: CalculateMetadataFunction<
  CaptionsProProps
> = ({ props }) => {
  const offset = props.timeOffsetSeconds ?? 0;
  const ends = props.words
    .map((w) => w.end - offset)
    .filter((end) => end > 0);
  const lastEnd = ends.length > 0 ? Math.max(...ends) : 1;
  return {
    width: props.width,
    height: props.height,
    durationInFrames: Math.max(
      1,
      Math.ceil((lastEnd + props.tailSeconds) * FPS),
    ),
    ...alphaDefaults,
  };
};

const calculateLowerThirdMetadata: CalculateMetadataFunction<
  LowerThirdProps
> = ({ props }) => ({
  width: props.width,
  height: props.height,
  durationInFrames: Math.max(FPS, Math.round(props.durationInSeconds * FPS)),
  ...alphaDefaults,
});

const calculateTextAnimMetadata: CalculateMetadataFunction<TextAnimProps> = ({
  props,
}) => ({
  width: props.width,
  height: props.height,
  durationInFrames: Math.max(
    Math.round(FPS / 2),
    Math.round(props.durationInSeconds * FPS),
  ),
  ...alphaDefaults,
});

const calculateTransitionWipeMetadata: CalculateMetadataFunction<
  TransitionWipeProps
> = ({ props }) => ({
  width: props.width,
  height: props.height,
  durationInFrames: Math.max(8, Math.round(props.durationInSeconds * FPS)),
  ...alphaDefaults,
});

const calculateNumberCounterMetadata: CalculateMetadataFunction<
  NumberCounterProps
> = ({ props }) => ({
  width: props.width,
  height: props.height,
  durationInFrames: Math.max(12, Math.round(props.durationInSeconds * FPS)),
  ...alphaDefaults,
});

const calculateTrackedOverlayMetadata: CalculateMetadataFunction<
  TrackedOverlayProps
> = ({ props }) => {
  const lastT = Math.max(...props.track.boxes.map((b) => b.t));
  const seconds = lastT / props.track.fps;
  return {
    width: props.width,
    height: props.height,
    durationInFrames: Math.max(1, Math.ceil(seconds * FPS) + 1),
    ...alphaDefaults,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Captions"
        component={Captions}
        fps={FPS}
        width={2160}
        height={3840}
        durationInFrames={150}
        schema={captionsSchema}
        defaultProps={{
          words: [
            { start: 0.2, end: 0.6, word: " Palavra" },
            { start: 0.6, end: 1.0, word: " por" },
            { start: 1.0, end: 1.5, word: " palavra" },
            { start: 1.7, end: 2.2, word: " animada" },
          ],
          width: 2160,
          height: 3840,
          timeOffsetSeconds: 0,
          tailSeconds: 0.5,
          fontSize: 140,
          textColor: "#FFFFFF",
          highlightColor: "#FFD400",
          strokeColor: "#000000",
          combineTokensWithinMilliseconds: 1000,
          baselineY: 0.82,
        }}
        calculateMetadata={calculateCaptionsMetadata}
      />
      <Composition
        id="CaptionsPro"
        component={CaptionsPro}
        fps={FPS}
        width={2160}
        height={3840}
        durationInFrames={150}
        schema={captionsProSchema}
        defaultProps={{
          words: [
            { start: 0.2, end: 0.6, word: " Legenda" },
            { start: 0.6, end: 1.0, word: " com" },
            { start: 1.0, end: 1.5, word: " preset" },
            { start: 1.7, end: 2.2, word: " nomeado" },
          ],
          width: 2160,
          height: 3840,
          timeOffsetSeconds: 0,
          tailSeconds: 0.5,
          preset: "shorts" as const,
        }}
        calculateMetadata={calculateCaptionsProMetadata}
      />
      <Composition
        id="LowerThird"
        component={LowerThird}
        fps={FPS}
        width={3840}
        height={2160}
        durationInFrames={150}
        schema={lowerThirdSchema}
        defaultProps={{
          name: "Bruno Correa",
          subtitle: "MetaCards",
          width: 3840,
          height: 2160,
          durationInSeconds: 5,
          accentColor: "#FFD400",
          textColor: "#FFFFFF",
          barColor: "#111111",
          x: 0.06,
          y: 0.78,
          scale: 1,
        }}
        calculateMetadata={calculateLowerThirdMetadata}
      />
      <Composition
        id="TextAnim"
        component={TextAnim}
        fps={FPS}
        width={3840}
        height={2160}
        durationInFrames={90}
        schema={textAnimSchema}
        defaultProps={{
          text: "MEDIUM LATENS",
          width: 3840,
          height: 2160,
          durationInSeconds: 3,
          fontSize: 260,
          color: "#FFFFFF",
          accentColor: "#FFD400",
          strokeColor: "#000000",
          y: 0.5,
        }}
        calculateMetadata={calculateTextAnimMetadata}
      />
      <Composition
        id="TransitionWipe"
        component={TransitionWipe}
        fps={FPS}
        width={3840}
        height={2160}
        durationInFrames={30}
        schema={transitionWipeSchema}
        defaultProps={{
          width: 3840,
          height: 2160,
          durationInSeconds: 1,
          mode: "wipe" as const,
          color: "#111111",
          accentColor: "#FFD400",
        }}
        calculateMetadata={calculateTransitionWipeMetadata}
      />
      <Composition
        id="TrackedOverlay"
        component={TrackedOverlay}
        fps={FPS}
        width={3840}
        height={2160}
        durationInFrames={90}
        schema={trackedOverlaySchema}
        defaultProps={{
          track: {
            fps: 30,
            boxes: [
              { t: 0, x: 0.1, y: 0.2, w: 0.25, h: 0.25 },
              { t: 45, x: 0.55, y: 0.35, w: 0.3, h: 0.3 },
              { t: 90, x: 0.35, y: 0.55, w: 0.22, h: 0.22 },
            ],
          },
          width: 3840,
          height: 2160,
          src: "",
          label: "",
          borderColor: "#FFD400",
          borderWidthPx: 8,
          cornerRadiusPx: 16,
          fillOpacity: 0,
        }}
        calculateMetadata={calculateTrackedOverlayMetadata}
      />
      <Composition
        id="NumberCounter"
        component={NumberCounter}
        fps={FPS}
        width={3840}
        height={2160}
        durationInFrames={66}
        schema={numberCounterSchema}
        defaultProps={{
          value: 700,
          prefix: "R$ ",
          suffix: "",
          countFrames: 20,
          width: 3840,
          height: 2160,
          durationInSeconds: 2.2,
          fontSize: 300,
          color: "#FFFFFF",
          accentColor: "#FFCB05",
          x: 0.5,
          y: 0.38,
        }}
        calculateMetadata={calculateNumberCounterMetadata}
      />
    </>
  );
};
