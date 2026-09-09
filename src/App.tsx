import { useMemo, useState } from "react";

import { LocationTabs } from "./components/LocationTabs";

import { PanoramaViewer } from "./components/PanoramaViewer";

import { Timeline } from "./components/Timeline";

import { useManifest } from "./hooks/useManifest";

import { usePreloadImages } from "./hooks/usePreloadImages";

import { buildFrameIndex, findNearestFrame } from "./services/frameIndex";

import { resolveFrameUrl } from "./services/manifest";

function readFrameTolerance(): number {
  const configuredMinutes = Number(
    import.meta.env.VITE_FRAME_TOLERANCE_MINUTES ?? "8",
  );

  if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) {
    return 8 * 60 * 1000;
  }

  return configuredMinutes * 60 * 1000;
}

const frameToleranceMilliseconds = readFrameTolerance();

export default function App() {
  const { manifest, loading, error } = useManifest();

  /*
   * These state values represent explicit user choices.
   *
   * A null value means that the user has not yet chosen
   * a time or location. Defaults are derived below
   * instead of being copied into state from an effect.
   */
  const [requestedTime, setRequestedTime] = useState<number | null>(null);

  const [requestedLocationId, setRequestedLocationId] = useState<string | null>(
    null,
  );

  /*
   * Group the frames by location and sort each group by
   * timestamp.
   */
  const frameIndex = useMemo(() => {
    return buildFrameIndex(manifest?.frames ?? []);
  }, [manifest]);

  /*
   * Calculate the complete time range across all
   * locations.
   */
  const timeRange = useMemo(() => {
    const frames = manifest?.frames ?? [];

    if (frames.length === 0) {
      return null;
    }

    let minimumTime = frames[0].timestamp;

    let maximumTime = frames[0].timestamp;

    for (let index = 1; index < frames.length; index += 1) {
      const timestamp = frames[index].timestamp;

      minimumTime = Math.min(minimumTime, timestamp);

      maximumTime = Math.max(maximumTime, timestamp);
    }

    return {
      minimumTime,
      maximumTime,
    };
  }, [manifest]);

  /*
   * Use the beginning of the dataset until the user
   * selects a time.
   *
   * Clamp an existing selection if a new manifest has a
   * narrower time range.
   */
  const selectedTime = useMemo(() => {
    if (!timeRange) {
      return null;
    }

    if (requestedTime === null) {
      return timeRange.minimumTime;
    }

    return Math.max(
      timeRange.minimumTime,
      Math.min(timeRange.maximumTime, requestedTime),
    );
  }, [requestedTime, timeRange]);

  /*
   * Determine which locations have a sufficiently close
   * frame at the currently selected time.
   */
  const availableLocationIds = useMemo(() => {
    const available = new Set<string>();

    if (!manifest || selectedTime === null) {
      return available;
    }

    for (const location of manifest.locations) {
      const nearest = findNearestFrame(
        frameIndex[location.id] ?? [],
        selectedTime,
      );

      if (nearest !== null && nearest.distance <= frameToleranceMilliseconds) {
        available.add(location.id);
      }
    }

    return available;
  }, [frameIndex, manifest, selectedTime]);

  /*
   * Use the location selected by the user when it is
   * available.
   *
   * Otherwise, temporarily fall back to the first
   * available location in manifest order.
   *
   * This is a derived value, so it does not require an
   * effect or another state update.
   */
  const activeLocationId = useMemo(() => {
    if (
      requestedLocationId !== null &&
      availableLocationIds.has(requestedLocationId)
    ) {
      return requestedLocationId;
    }

    if (!manifest) {
      return null;
    }

    const firstAvailableLocation = manifest.locations.find((location) => {
      return availableLocationIds.has(location.id);
    });

    return firstAvailableLocation?.id ?? null;
  }, [availableLocationIds, manifest, requestedLocationId]);

  /*
   * Find the frame at the active location that is
   * closest to the selected master timestamp.
   */
  const activeMatch = useMemo(() => {
    if (activeLocationId === null || selectedTime === null) {
      return null;
    }

    return findNearestFrame(frameIndex[activeLocationId] ?? [], selectedTime);
  }, [activeLocationId, frameIndex, selectedTime]);

  /*
   * Reject the nearest frame if it falls outside the
   * configured availability tolerance.
   */
  const activeFrame = useMemo(() => {
    if (
      activeMatch === null ||
      activeMatch.distance > frameToleranceMilliseconds
    ) {
      return null;
    }

    return activeMatch.frame;
  }, [activeMatch]);

  /*
   * Resolve the path stored in the manifest against the
   * public R2 base URL.
   */
  const activeImageUrl = useMemo(() => {
    if (!activeFrame) {
      return null;
    }

    return resolveFrameUrl(activeFrame.imagePath);
  }, [activeFrame]);

  /*
   * Preload only the immediately preceding and following
   * frames at the current location.
   */
  const preloadUrls = useMemo(() => {
    if (activeLocationId === null || activeMatch === null) {
      return [];
    }

    const locationFrames = frameIndex[activeLocationId] ?? [];

    const urls: string[] = [];

    const previousFrame = locationFrames[activeMatch.index - 1];

    const nextFrame = locationFrames[activeMatch.index + 1];

    if (previousFrame) {
      urls.push(resolveFrameUrl(previousFrame.imagePath));
    }

    if (nextFrame) {
      urls.push(resolveFrameUrl(nextFrame.imagePath));
    }

    return urls;
  }, [activeLocationId, activeMatch, frameIndex]);

  usePreloadImages(preloadUrls);

  /*
   * Move through the actual frame sequence at the active
   * location rather than changing the time by an
   * arbitrary fixed interval.
   */
  function moveByFrame(direction: -1 | 1): void {
    if (activeLocationId === null || selectedTime === null) {
      return;
    }

    const locationFrames = frameIndex[activeLocationId] ?? [];

    const currentMatch = findNearestFrame(locationFrames, selectedTime);

    if (currentMatch === null) {
      return;
    }

    const targetIndex = Math.max(
      0,
      Math.min(locationFrames.length - 1, currentMatch.index + direction),
    );

    const targetFrame = locationFrames[targetIndex];

    if (!targetFrame) {
      return;
    }

    setRequestedTime(targetFrame.timestamp);
  }

  if (loading) {
    return (
      <main className="centered-message">
        <p>Loading panorama manifest...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main
        className={["centered-message", "centered-message--error"].join(" ")}
        role="alert"
      >
        <div>
          <h1>Unable to load panorama data</h1>

          <p>{error.message}</p>
        </div>
      </main>
    );
  }

  if (!manifest || !timeRange || selectedTime === null) {
    return (
      <main className="centered-message">
        <div>
          <h1>No panoramas found</h1>

          <p>Add your images and generate the panorama manifest.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="application">
      <div className="application-shell">
        <header className="application-header">
          <div>
            <p className="header-eyebrow">Research image viewer</p>

            <h1>360 Timelapse Viewer</h1>

            <p className="header-description">
              {manifest.frames.length} frames across {manifest.locations.length}{" "}
              locations
            </p>
          </div>
        </header>

        <LocationTabs
          locations={manifest.locations}
          availableLocationIds={availableLocationIds}
          activeLocationId={activeLocationId}
          onChange={setRequestedLocationId}
        />

        {activeImageUrl !== null && activeFrame !== null ? (
          <PanoramaViewer imageUrl={activeImageUrl} />
        ) : (
          <section className="viewer-shell">
            <div className="no-frame-message">
              <div>
                <h2>No panorama near this time</h2>

                <p>Select another time or available location.</p>
              </div>
            </div>
          </section>
        )}

        <Timeline
          minimumTime={timeRange.minimumTime}
          maximumTime={timeRange.maximumTime}
          selectedTime={selectedTime}
          selectedTimeLabel={new Date(selectedTime).toLocaleString()}
          frameLabel={
            activeFrame
              ? [activeFrame.locationId, activeFrame.id].join(" · ")
              : "No frame"
          }
          onChange={setRequestedTime}
          onPreviousFrame={() => {
            moveByFrame(-1);
          }}
          onNextFrame={() => {
            moveByFrame(1);
          }}
        />
      </div>
    </main>
  );
}
