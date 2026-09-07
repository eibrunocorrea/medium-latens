// Default export settings: every composition in this project is a transparent
// overlay meant for Premiere, so ProRes 4444 with alpha is the default.
// (See skills-master/remotion-best-practices/rules/transparent-videos.md)
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setPixelFormat("yuva444p10le");
Config.setCodec("prores");
Config.setProResProfile("4444");
Config.setOverwriteOutput(true);
