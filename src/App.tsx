import { useMemo, useState } from "react";

import { LocationTabs } from "./components/LocationTabs";

import { PanoramaViewer } from "./components/PanoramaViewer";

import { Timeline } from "./components/Timeline";

import { useManifest } from "./hooks/useManifest";

import { buildCaptureSessions } from "./services/frameIndex";

import { resolveFrameUrl } from "./services/manifest";

export default function App() {
  const { manifest, loading, error } = useManifest();

  const [requestedSessionIndex, setRequestedSessionIndex] = useState(0);

  const [requestedLocationId, setRequestedLocationId] = useState<string | null>(
    null,
  );

  /*
   * Build one timeline position per capture day.
   */
  const captureSessions = useMemo(() => {
    return buildCaptureSessions(manifest?.frames ?? []);
  }, [manifest]);

  /*
   * Keep the index valid if the manifest changes.
   */
  const selectedSessionIndex = useMemo(() => {
    if (captureSessions.length === 0) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(captureSessions.length - 1, requestedSessionIndex),
    );
  }, [captureSessions.length, requestedSessionIndex]);

  const selectedSession = captureSessions[selectedSessionIndex] ?? null;

  /*
   * The selected session determines exactly which
   * location tabs are available.
   */
  const availableLocationIds = useMemo(() => {
    return new Set<string>(
      Object.keys(selectedSession?.framesByLocation ?? {}),
    );
  }, [selectedSession]);

  /*
   * Preserve the user's requested location whenever it
   * exists in the current session.
   *
   * During the early single-location period this will
   * naturally fall back to the main location.
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

  const activeFrame = useMemo(() => {
    if (activeLocationId === null || selectedSession === null) {
      return null;
    }

    return selectedSession.framesByLocation[activeLocationId] ?? null;
  }, [activeLocationId, selectedSession]);

  const activeImageUrl = useMemo(() => {
    if (!activeFrame) {
      return null;
    }

    return resolveFrameUrl(activeFrame.imagePath);
  }, [activeFrame]);

  function selectSession(sessionIndex: number): void {
    const maximumIndex = captureSessions.length - 1;

    setRequestedSessionIndex(Math.max(0, Math.min(maximumIndex, sessionIndex)));
  }

  function moveBySession(direction: -1 | 1): void {
    selectSession(selectedSessionIndex + direction);
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

  if (!manifest || captureSessions.length === 0 || selectedSession === null) {
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
          onChange={setRequestedLocationId}
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
          frameLabel={activeFrame ? activeFrame.id : "No frame"}
          onChange={selectSession}
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
