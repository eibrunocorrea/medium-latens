#!/usr/bin/env python3
"""Object tracking on a master video via OpenCV CSRT.

Extracts a frame stream with ffmpeg (downscaled to max 960px wide for speed),
runs the CSRT tracker from an initial normalized bbox, and writes a track JSON
consumable by the Remotion overlay pipeline.

Usage:
  python3 engine/track.py "<master>" \
      --start S --dur D --bbox x,y,w,h [--sample-fps 15] [-o out.json]

Coordinates are NORMALIZED (0-1) on input and output, relative to the full
frame. Timestamps `t` are seconds on the MASTER clip.

Last line of output is machine-parseable:
  TRACK_JSON=<path> BOXES=<n> LOST=<n>
"""

import argparse
import json
import subprocess
import sys

import cv2
import numpy as np

MAX_WIDTH = 960


def probe_dimensions(path: str) -> tuple[int, int]:
    """Return (width, height) of the first video stream."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json", path,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    stream = json.loads(out.stdout)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def frame_stream(path: str, start: float, dur: float, fps: float,
                 width: int, height: int):
    """Yield BGR frames (numpy arrays) from ffmpeg rawvideo pipe."""
    cmd = [
        "ffmpeg", "-v", "error",
        "-ss", f"{start:.6f}", "-t", f"{dur:.6f}",
        "-i", path,
        "-vf", f"fps={fps},scale={width}:{height}",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-",
    ]
    frame_bytes = width * height * 3
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3)
    finally:
        proc.stdout.close()
        proc.wait()


def parse_bbox(spec: str) -> tuple[float, float, float, float]:
    parts = [float(p) for p in spec.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox must be x,y,w,h")
    for v in parts:
        if not 0.0 <= v <= 1.0:
            raise argparse.ArgumentTypeError(
                "bbox values must be normalized (0-1)")
    x, y, w, h = parts
    if w <= 0 or h <= 0 or x + w > 1.0 or y + h > 1.0:
        raise argparse.ArgumentTypeError(
            "bbox must have positive size and fit inside the frame")
    return x, y, w, h


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("master", help="path to the master video")
    ap.add_argument("--start", type=float, required=True,
                    help="start time on the master, seconds")
    ap.add_argument("--dur", type=float, required=True,
                    help="duration to track, seconds")
    ap.add_argument("--bbox", type=parse_bbox, required=True,
                    help="initial bbox, normalized x,y,w,h")
    ap.add_argument("--sample-fps", type=float, default=15.0,
                    help="tracking sample rate (default 15)")
    ap.add_argument("-o", "--output", default="track.json",
                    help="output track JSON path (default track.json)")
    args = ap.parse_args()

    src_w, src_h = probe_dimensions(args.master)
    if src_w > MAX_WIDTH:
        work_w = MAX_WIDTH
        work_h = round(src_h * MAX_WIDTH / src_w)
    else:
        work_w, work_h = src_w, src_h
    # even dimensions keep every scaler happy
    work_w -= work_w % 2
    work_h -= work_h % 2

    nx, ny, nw, nh = args.bbox
    init_box = (
        int(round(nx * work_w)),
        int(round(ny * work_h)),
        max(1, int(round(nw * work_w))),
        max(1, int(round(nh * work_h))),
    )

    tracker = cv2.TrackerCSRT_create()
    boxes = []
    lost = 0

    for i, frame in enumerate(
            frame_stream(args.master, args.start, args.dur,
                         args.sample_fps, work_w, work_h)):
        t = args.start + i / args.sample_fps
        if i == 0:
            tracker.init(frame, init_box)
            bx, by, bw, bh = init_box
        else:
            ok, box = tracker.update(frame)
            if not ok:
                lost += 1
                print(f"tracker lost target at t={t:.3f}s "
                      f"(frame {i}); stopping", file=sys.stderr)
                break
            bx, by, bw, bh = box
        boxes.append({
            "t": round(t, 4),
            "x": round(bx / work_w, 5),
            "y": round(by / work_h, 5),
            "w": round(bw / work_w, 5),
            "h": round(bh / work_h, 5),
        })

    if not boxes:
        print("no frames decoded — check --start/--dur against the master",
              file=sys.stderr)
        return 1

    track = {
        "fps": args.sample_fps,
        "source": args.master,
        "start": args.start,
        "boxes": boxes,
    }
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(track, fh, indent=2)

    print(f"TRACK_JSON={args.output} BOXES={len(boxes)} LOST={lost}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
