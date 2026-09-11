import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocationTabs } from "./components/LocationTabs";
import { PanoramaViewer } from "./components/PanoramaViewer";
import { Timeline } from "./components/Timeline";
import { useManifest } from "./hooks/useManifest";
import { buildCaptureSessions } from "./services/frameIndex";
import { resolveFrameUrl } from "./services/manifest";
import type { PanoramaFrame, TiledPanorama } from "./types";

const TIMELINE_SETTLE_DELAY_MS = 250;

export interface TiledPanoramaSource {
  id: string;
  width: number;
  cols: number;
  rows: number;
  baseUrl: string;
  tileDirectoryUrl: string;
  fallbackUrl: string;
}

function createTiledPanoramaSource(
  frame: PanoramaFrame,
  panorama: TiledPanorama,
): TiledPanoramaSource {
  return {
    id: frame.id,
    width: panorama.width,
    cols: panorama.cols,
    rows: panorama.rows,
    baseUrl: resolveFrameUrl(panorama.basePath),
    tileDirectoryUrl: resolveFrameUrl(panorama.tileDirectory),
    fallbackUrl: resolveFrameUrl(frame.imagePath),
  };
}

export default function App() {
  const { manifest, loading, error } = useManifest();

  /*
   * requestedSessionIndex controls the timeline thumb and labels.
   *
   * displayedSessionIndex controls the panorama supplied to
   * PanoramaViewer.
   */
  const [requestedSessionIndex, setRequestedSessionIndex] = useState(0);

  const [displayedSessionIndex, setDisplayedSessionIndex] = useState(0);

  const [requestedLocationId, setRequestedLocationId] = useState<string | null>(
    null,
  );

  /*
   * Timeline movement is allowed to settle before the expensive
   * panorama change occurs.
   */
  const timelineCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const captureSessions = useMemo(() => {
    return buildCaptureSessions(manifest?.frames ?? []);
  }, [manifest]);

  /*
   * Clamp indexes as derived values instead of synchronizing them
   * with setState inside an effect.
   */
  const clampSessionIndex = useCallback(
    (sessionIndex: number): number => {
      if (captureSessions.length === 0) {
        return 0;
      }

      return Math.max(0, Math.min(captureSessions.length - 1, sessionIndex));
    },
    [captureSessions.length],
  );

  /*
   * This index follows the timeline immediately.
   */
  const selectedSessionIndex = clampSessionIndex(requestedSessionIndex);

  /*
   * This index controls the panorama viewer.
   */
  const activeViewerSessionIndex = clampSessionIndex(displayedSessionIndex);

  const selectedSession = captureSessions[selectedSessionIndex] ?? null;

  const activeViewerSession = captureSessions[activeViewerSessionIndex] ?? null;

  /*
   * The effect only cleans up the pending timer. It does not call
   * a state setter.
   */
  useEffect(() => {
    return () => {
      if (timelineCommitTimerRef.current !== null) {
        clearTimeout(timelineCommitTimerRef.current);
      }
    };
  }, []);

  /*
   * Available locations are based on the session currently supplied
   * to the viewer, not an intermediate timeline position.
   */
  const availableLocationIds = useMemo(() => {
    return new Set<string>(
      Object.keys(activeViewerSession?.framesByLocation ?? {}),
    );
  }, [activeViewerSession]);

  /*
   * Preserve the requested location when it is available.
   * Otherwise, select the first available manifest location.
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

    return (
      manifest.locations.find((location) => {
        return availableLocationIds.has(location.id);
      })?.id ?? null
    );
  }, [availableLocationIds, manifest, requestedLocationId]);

  /*
   * This frame controls the panorama viewer.
   */
  const activeFrame = useMemo(() => {
    if (activeLocationId === null || activeViewerSession === null) {
      return null;
    }

    return activeViewerSession.framesByLocation[activeLocationId] ?? null;
  }, [activeLocationId, activeViewerSession]);

  /*
   * Construct the tiled source only when the manifest contains
   * completed tile metadata.
   *
   * The object contains a stable frame ID that PanoramaViewer uses
   * for latest-selection comparisons.
   */
  const activePanorama = useMemo(() => {
    if (!activeFrame || !activeFrame.panorama) {
      return null;
    }

    return createTiledPanoramaSource(activeFrame, activeFrame.panorama);
  }, [activeFrame]);

  /*
   * This frame controls the timeline label. It follows the timeline
   * immediately while the panorama waits for the settle timer.
   */
  const selectedTimelineFrame = useMemo(() => {
    if (activeLocationId === null || selectedSession === null) {
      return null;
    }

    return selectedSession.framesByLocation[activeLocationId] ?? null;
  }, [activeLocationId, selectedSession]);

  const clearTimelineCommitTimer = useCallback((): void => {
    if (timelineCommitTimerRef.current === null) {
      return;
    }

    clearTimeout(timelineCommitTimerRef.current);

    timelineCommitTimerRef.current = null;
  }, []);

  /*
   * Discrete actions such as Previous and Next update both the
   * timeline and panorama immediately.
   */
  const selectSessionImmediately = useCallback(
    (sessionIndex: number): void => {
      const nextIndex = clampSessionIndex(sessionIndex);

      clearTimelineCommitTimer();

      setRequestedSessionIndex(nextIndex);

      setDisplayedSessionIndex(nextIndex);
    },
    [clampSessionIndex, clearTimelineCommitTimer],
  );

  /*
   * Timeline scrubbing updates the thumb and labels immediately,
   * but delays the panorama change until movement settles.
   */
  const selectTimelineSession = useCallback(
    (sessionIndex: number): void => {
      const nextIndex = clampSessionIndex(sessionIndex);

      setRequestedSessionIndex(nextIndex);

      clearTimelineCommitTimer();

      timelineCommitTimerRef.current = setTimeout(() => {
        setDisplayedSessionIndex(nextIndex);

        timelineCommitTimerRef.current = null;
      }, TIMELINE_SETTLE_DELAY_MS);
    },
    [clampSessionIndex, clearTimelineCommitTimer],
  );

  const moveBySession = useCallback(
    (direction: -1 | 1): void => {
      selectSessionImmediately(activeViewerSessionIndex + direction);
    },
    [activeViewerSessionIndex, selectSessionImmediately],
  );

  /*
   * Location selection is a discrete action.
   *
   * If a delayed timeline commit is pending, selecting a location
   * commits the visible timeline position immediately.
   */
  const selectLocation = useCallback(
    (locationId: string): void => {
      clearTimelineCommitTimer();

      setDisplayedSessionIndex(selectedSessionIndex);

      setRequestedLocationId(locationId);
    },
    [clearTimelineCommitTimer, selectedSessionIndex],
  );

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

  if (
    !manifest ||
    captureSessions.length === 0 ||
    selectedSession === null ||
    activeViewerSession === null
  ) {
    return (
      <main className="centered-message">
        <div>
          <h1>No panoramas found</h1>

          <p>Add the images and regenerate the panorama manifest.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="application">
      <div className="application-shell">
        <header className="application-header">
          <div>
            <h1>360 Timelapse Viewer</h1>

            <p className="header-description">
              {manifest.frames.length} images across {captureSessions.length}{" "}
              days and {manifest.locations.length} locations
            </p>
          </div>
        </header>

        <LocationTabs
          locations={manifest.locations}
          availableLocationIds={availableLocationIds}
          activeLocationId={activeLocationId}
          onChange={selectLocation}
        />

        {activePanorama !== null ? (
          <PanoramaViewer panorama={activePanorama} />
        ) : (
          <section className="viewer-shell">
            <div className="no-frame-message">
              <div>
                <h2>Tiled panorama unavailable</h2>

                <p>
                  Generate and upload the tiled assets for this capture, then
                  regenerate the manifest.
                </p>
              </div>
            </div>
          </section>
        )}

        <Timeline
          selectedIndex={selectedSessionIndex}
          totalSessions={captureSessions.length}
          selectedDateLabel={new Date(
            selectedSession.timestamp,
          ).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          frameLabel={
            selectedTimelineFrame ? selectedTimelineFrame.id : "No frame"
          }
          onChange={selectTimelineSession}
          onPrevious={() => {
            moveBySession(-1);
          }}
          onNext={() => {
            moveBySession(1);
          }}
        />
      </div>
    </main>
  );
}
