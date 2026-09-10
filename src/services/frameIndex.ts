import type { PanoramaFrame } from "../types";

export interface CaptureSession {
  /*
   * Used for displaying and sorting the session.
   *
   * This is the timestamp of the earliest image in the
   * session, not necessarily the timestamp of every
   * image in the session.
   */
  timestamp: number;

  /*
   * ISO-style calendar key, such as 2026-02-11.
   */
  dateKey: string;

  /*
   * One frame per location for this capture session.
   */
  framesByLocation: Record<string, PanoramaFrame>;
}

/*
 * The manifest parser currently interprets the camera
 * filename as UTC. Therefore, use the UTC date here too.
 *
 * This prevents session grouping from changing according
 * to the timezone of the computer viewing the site.
 */
function createDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/*
 * Group images taken on the same calendar date into one
 * capture session.
 *
 * This matches the acquisition process:
 *
 * - sessions are separated by days
 * - location images within a session are separated by
 *   minutes
 */
export function buildCaptureSessions(
  frames: PanoramaFrame[],
): CaptureSession[] {
  const sessionsByDate = new Map<string, CaptureSession>();

  const sortedFrames = [...frames].sort((left, right) => {
    return left.timestamp - right.timestamp;
  });

  for (const frame of sortedFrames) {
    const dateKey = createDateKey(frame.timestamp);

    const existingSession = sessionsByDate.get(dateKey);

    if (existingSession) {
      if (existingSession.framesByLocation[frame.locationId]) {
        console.warn(
          "Multiple frames found for one location in one capture session.",
          {
            dateKey,
            locationId: frame.locationId,
            retainedFrame: existingSession.framesByLocation[frame.locationId],
            ignoredFrame: frame,
          },
        );

        continue;
      }

      existingSession.framesByLocation[frame.locationId] = frame;

      existingSession.timestamp = Math.min(
        existingSession.timestamp,
        frame.timestamp,
      );

      continue;
    }

    sessionsByDate.set(dateKey, {
      dateKey,
      timestamp: frame.timestamp,

      framesByLocation: {
        [frame.locationId]: frame,
      },
    });
  }

  return Array.from(sessionsByDate.values()).sort((left, right) => {
    return left.timestamp - right.timestamp;
  });
}
