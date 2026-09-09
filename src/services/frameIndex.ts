import type { PanoramaFrame } from "../types";

export type FrameIndex = Record<string, PanoramaFrame[]>;

export interface NearestFrameResult {
  frame: PanoramaFrame;
  index: number;
  distance: number;
}

export function buildFrameIndex(frames: PanoramaFrame[]): FrameIndex {
  const index: FrameIndex = {};

  for (const frame of frames) {
    index[frame.locationId] ??= [];
    index[frame.locationId].push(frame);
  }

  for (const locationFrames of Object.values(index)) {
    locationFrames.sort((left, right) => left.timestamp - right.timestamp);
  }

  return index;
}

export function findNearestFrame(
  frames: PanoramaFrame[],
  timestamp: number,
): NearestFrameResult | null {
  if (frames.length === 0) {
    return null;
  }

  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const middleTimestamp = frames[middle].timestamp;

    if (middleTimestamp < timestamp) {
      low = middle + 1;
    } else if (middleTimestamp > timestamp) {
      high = middle - 1;
    } else {
      return {
        frame: frames[middle],
        index: middle,
        distance: 0,
      };
    }
  }

  const beforeIndex = Math.max(0, high);
  const afterIndex = Math.min(frames.length - 1, low);

  const beforeDistance = Math.abs(frames[beforeIndex].timestamp - timestamp);
  const afterDistance = Math.abs(frames[afterIndex].timestamp - timestamp);

  const nearestIndex =
    beforeDistance <= afterDistance ? beforeIndex : afterIndex;

  return {
    frame: frames[nearestIndex],
    index: nearestIndex,
    distance: Math.abs(frames[nearestIndex].timestamp - timestamp),
  };
}
