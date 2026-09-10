import { useCallback, useEffect, useRef, useState } from "react";
import { events, Viewer } from "@photo-sphere-viewer/core";
import type { ViewerPose } from "../types";

interface PanoramaViewerProps {
  imageUrl: string;
  onPoseChange?: (pose: ViewerPose) => void;
}

function getLoadErrorMessage(reason: unknown, imageUrl: string): string {
  if (reason instanceof Error) {
    return reason.message;
  }

  if (reason instanceof Event && reason.target instanceof HTMLImageElement) {
    const failedUrl = reason.target.currentSrc || reason.target.src || imageUrl;

    return `The browser could not load the panorama: ${failedUrl}`;
  }

  return "The panorama could not be loaded.";
}

export function PanoramaViewer({
  imageUrl,
  onPoseChange,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  /*
   * The panorama most recently installed successfully.
   */
  const currentImageUrlRef = useRef(imageUrl);

  /*
   * The panorama most recently requested by React.
   *
   * Rapid navigation updates this value without starting
   * overlapping setPanorama operations.
   */
  const desiredImageUrlRef = useRef(imageUrl);

  const onPoseChangeRef = useRef(onPoseChange);

  const poseRef = useRef<ViewerPose>({
    yaw: 0,
    pitch: 0,
    zoom: 50,
  });

  /*
   * Only one setPanorama operation may run at a time.
   */
  const panoramaLoadRunningRef = useRef(false);

  /*
   * Programmatic position and zoom events can occur while changing
   * panoramas. Those events should not overwrite the user's pose.
   */
  const panoramaChangingRef = useRef(false);

  /*
   * Prevent asynchronous work from updating state after unmount.
   */
  const mountedRef = useRef(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [panoramaLoading, setPanoramaLoading] = useState(false);

  useEffect(() => {
    onPoseChangeRef.current = onPoseChange;
  }, [onPoseChange]);

  /*
   * Process panorama changes sequentially.
   *
   * If several selections occur while one panorama is loading,
   * intermediate selections are skipped and only the newest desired
   * panorama is loaded next.
   */
  const processDesiredPanorama = useCallback(
    async (viewer: Viewer): Promise<void> => {
      if (panoramaLoadRunningRef.current) {
        return;
      }

      panoramaLoadRunningRef.current = true;
      panoramaChangingRef.current = true;

      if (mountedRef.current) {
        setPanoramaLoading(true);
        setLoadError(null);
      }

      try {
        while (
          mountedRef.current &&
          currentImageUrlRef.current !== desiredImageUrlRef.current
        ) {
          const requestedUrl = desiredImageUrlRef.current;

          const startedAt = performance.now();

          const currentPosition = viewer.getPosition();

          const preservedPose: ViewerPose = {
            yaw: currentPosition.yaw,
            pitch: currentPosition.pitch,
            zoom: viewer.getZoomLevel(),
          };

          poseRef.current = preservedPose;

          console.debug("Panorama change started.", {
            requestedUrl,
          });

          try {
            await viewer.setPanorama(requestedUrl, {
              transition: false,
              position: {
                yaw: preservedPose.yaw,
                pitch: preservedPose.pitch,
              },
              zoom: preservedPose.zoom,
              showLoader: false,
            });

            if (!mountedRef.current) {
              return;
            }

            /*
             * This panorama completed successfully. If the user has
             * since selected another panorama, the loop continues
             * directly to the newest desired URL.
             */
            currentImageUrlRef.current = requestedUrl;

            console.debug("Panorama change completed.", {
              requestedUrl,
              durationMs: Math.round(performance.now() - startedAt),
              superseded: requestedUrl !== desiredImageUrlRef.current,
            });
          } catch (reason: unknown) {
            if (!mountedRef.current) {
              return;
            }

            const wasSuperseded = requestedUrl !== desiredImageUrlRef.current;

            if (wasSuperseded) {
              /*
               * A newer selection replaced this one. The failed
               * operation must not display an error or stop the
               * loading indicator.
               */
              console.debug("Superseded panorama request ended.", {
                requestedUrl,
                desiredUrl: desiredImageUrlRef.current,
                durationMs: Math.round(performance.now() - startedAt),
                reason,
              });

              continue;
            }

            /*
             * The panorama that is still desired genuinely failed.
             */
            console.error("Current panorama failed to load.", {
              requestedUrl,
              durationMs: Math.round(performance.now() - startedAt),
              reason,
            });

            setLoadError(getLoadErrorMessage(reason, requestedUrl));

            /*
             * Stop instead of continuously retrying the same URL.
             */
            break;
          }
        }
      } finally {
        panoramaLoadRunningRef.current = false;
        panoramaChangingRef.current = false;

        if (mountedRef.current) {
          setPanoramaLoading(false);
        }
      }
    },
    [],
  );

  /*
   * Create one long-lived Photo Sphere Viewer instance.
   */
  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    mountedRef.current = true;

    const viewer = new Viewer({
      container,
      panorama: currentImageUrlRef.current,
      navbar: ["zoom", "move", "fullscreen"],
      defaultZoomLvl: poseRef.current.zoom,
      mousewheelCtrlKey: false,
    });

    viewerRef.current = viewer;

    const positionListener: EventListenerObject = {
      handleEvent(event: Event): void {
        if (
          panoramaChangingRef.current ||
          !(event instanceof events.PositionUpdatedEvent)
        ) {
          return;
        }

        const nextPose: ViewerPose = {
          ...poseRef.current,
          yaw: event.position.yaw,
          pitch: event.position.pitch,
        };

        poseRef.current = nextPose;
        onPoseChangeRef.current?.(nextPose);
      },
    };

    const zoomListener: EventListenerObject = {
      handleEvent(event: Event): void {
        if (
          panoramaChangingRef.current ||
          !(event instanceof events.ZoomUpdatedEvent)
        ) {
          return;
        }

        const nextPose: ViewerPose = {
          ...poseRef.current,
          zoom: event.zoomLevel,
        };

        poseRef.current = nextPose;
        onPoseChangeRef.current?.(nextPose);
      },
    };

    const readyListener: EventListenerObject = {
      handleEvent(): void {
        if (!mountedRef.current) {
          return;
        }

        const position = viewer.getPosition();

        poseRef.current = {
          yaw: position.yaw,
          pitch: position.pitch,
          zoom: viewer.getZoomLevel(),
        };

        panoramaChangingRef.current = false;
        setPanoramaLoading(false);
        setLoadError(null);
      },
    };

    viewer.addEventListener(events.PositionUpdatedEvent.type, positionListener);

    viewer.addEventListener(events.ZoomUpdatedEvent.type, zoomListener);

    viewer.addEventListener(events.ReadyEvent.type, readyListener, {
      once: true,
    });

    return () => {
      mountedRef.current = false;
      viewerRef.current = null;

      viewer.removeEventListener(
        events.PositionUpdatedEvent.type,
        positionListener,
      );

      viewer.removeEventListener(events.ZoomUpdatedEvent.type, zoomListener);

      viewer.removeEventListener(events.ReadyEvent.type, readyListener);

      viewer.destroy();
    };
  }, []);

  /*
   * Record the latest requested URL.
   *
   * processDesiredPanorama starts a load only when another load is
   * not already running. Otherwise, the running processor picks up
   * this URL when its current operation finishes.
   */
  useEffect(() => {
    desiredImageUrlRef.current = imageUrl;

    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    void processDesiredPanorama(viewer);
  }, [imageUrl, processDesiredPanorama]);

  return (
    <section className="viewer-shell">
      <div ref={containerRef} className="panorama-viewer" />

      {panoramaLoading && (
        <div className="viewer-loading-status" role="status" aria-live="polite">
          Loading capture...
        </div>
      )}

      {loadError && (
        <div className="viewer-error" role="alert">
          <div>
            <h2>Unable to load panorama</h2>
            <p>{loadError}</p>
          </div>
        </div>
      )}
    </section>
  );
}
