import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocationTabs } from "./components/LocationTabs";
import { PanoramaViewer } from "./components/PanoramaViewer";
import { Timeline } from "./components/Timeline";
import { useManifest } from "./hooks/useManifest";
import { buildCaptureSessions } from "./services/frameIndex";
import { resolveFrameUrl } from "./services/manifest";

const TIMELINE_SETTLE_DELAY_MS = 250;

export default function App() {
  const { manifest, loading, error } = useManifest();

  /*
   * requestedSessionIndex controls the timeline thumb and labels.
   *
   * displayedSessionIndex controls the panorama that is actually
   * passed to PanoramaViewer.
   */
  const [requestedSessionIndex, setRequestedSessionIndex] = useState(0);

  const [displayedSessionIndex, setDisplayedSessionIndex] = useState(0);

  const [requestedLocationId, setRequestedLocationId] = useState<string | null>(
    null,
  );

  /*
   * The timer delays the expensive panorama change while the user
   * is continuously moving the timeline.
   */
  const timelineCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const captureSessions = useMemo(() => {
    return buildCaptureSessions(manifest?.frames ?? []);
  }, [manifest]);

  /*
   * Clamp indexes as derived values rather than synchronizing them
   * through an effect.
   *
   * This avoids synchronous setState calls inside an effect.
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
   * This index changes only after timeline movement settles or an
   * immediate navigation operation occurs.
   */
  const activeViewerSessionIndex = clampSessionIndex(displayedSessionIndex);

  const selectedSession = captureSessions[selectedSessionIndex] ?? null;

  const activeViewerSession = captureSessions[activeViewerSessionIndex] ?? null;

  /*
   * This effect only cleans up the pending timer.
   *
   * It does not update React state.
   */
  useEffect(() => {
    return () => {
      if (timelineCommitTimerRef.current !== null) {
        clearTimeout(timelineCommitTimerRef.current);
      }
    };
  }, []);

  /*
   * The available locations are based on the panorama session
   * currently supplied to the viewer, not an intermediate timeline
   * position.
   */
  const availableLocationIds = useMemo(() => {
    return new Set<string>(
      Object.keys(activeViewerSession?.framesByLocation ?? {}),
    );
  }, [activeViewerSession]);

  /*
   * Preserve the requested location when it exists in the active
   * viewer session. Otherwise, select the first available location.
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
   * This frame controls the actual panorama viewer.
   */
  const activeFrame = useMemo(() => {
    if (activeLocationId === null || activeViewerSession === null) {
      return null;
    }

    return activeViewerSession.framesByLocation[activeLocationId] ?? null;
  }, [activeLocationId, activeViewerSession]);

  const activeImageUrl = useMemo(() => {
    if (!activeFrame) {
      return null;
    }

    return resolveFrameUrl(activeFrame.imagePath);
  }, [activeFrame]);

  /*
   * This frame controls the timeline label. It follows the timeline
   * immediately, even before its panorama is committed.
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
   * Previous, Next, and other discrete selection actions use this
   * function. They update the timeline and panorama immediately.
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
   * Timeline movement updates the thumb immediately but delays the
   * full panorama change.
   *
   * Each new timeline event replaces the previous timer. Therefore,
   * only the final settled timeline position reaches PanoramaViewer.
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
   * Selecting a location is a discrete action.
   *
   * If the user has moved the timeline but the delayed commit has
   * not occurred yet, selecting a location commits that timeline
   * position immediately.
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
            <p className="header-eyebrow">Research image viewer</p>

            <h1>360 Timelapse Viewer</h1>

            <p className="header-description">
              {manifest.frames.length} images across {captureSessions.length}{" "}
              capture sessions and {manifest.locations.length} locations
            </p>
          </div>
        </header>

        <LocationTabs
          locations={manifest.locations}
          availableLocationIds={availableLocationIds}
          activeLocationId={activeLocationId}
          onChange={selectLocation}
        />

        {activeImageUrl !== null ? (
          <PanoramaViewer imageUrl={activeImageUrl} />
        ) : (
          <section className="viewer-shell">
            <div className="no-frame-message">
              <div>
                <h2>No panorama available</h2>
                <p>Select an available location.</p>
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
