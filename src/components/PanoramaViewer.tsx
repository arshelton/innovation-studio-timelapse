import { useEffect, useRef, useState } from "react";
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
   * This contains the panorama that was most recently installed
   * successfully.
   */
  const currentImageUrlRef = useRef(imageUrl);

  /*
   * Keep the latest callback available to the long-lived viewer
   * event listeners without recreating the viewer.
   */
  const onPoseChangeRef = useRef(onPoseChange);

  const poseRef = useRef<ViewerPose>({
    yaw: 0,
    pitch: 0,
    zoom: 50,
  });

  /*
   * Programmatic position and zoom events can occur while a new
   * panorama is being installed.
   *
   * Those events should not overwrite the user's saved pose.
   */
  const panoramaChangingRef = useRef(false);

  /*
   * Every requested panorama receives a unique number.
   *
   * Promise completions from older requests are ignored so they
   * cannot change loading or error state after a newer request.
   */
  const requestNumberRef = useRef(0);

  /*
   * Prevent asynchronous viewer work from attempting state updates
   * after the component has unmounted.
   */
  const mountedRef = useRef(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [panoramaLoading, setPanoramaLoading] = useState(false);

  useEffect(() => {
    onPoseChangeRef.current = onPoseChange;
  }, [onPoseChange]);

  /*
   * Create one long-lived Photo Sphere Viewer instance.
   *
   * Later image changes are handled by the imageUrl effect below.
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

      /*
       * Invalidate any pending setPanorama completion.
       */
      requestNumberRef.current += 1;

      viewer.removeEventListener(
        events.PositionUpdatedEvent.type,
        positionListener,
      );

      viewer.removeEventListener(events.ZoomUpdatedEvent.type, zoomListener);

      /*
       * ReadyEvent was registered with once: true. Removing it is
       * still useful if unmount occurs before the initial panorama
       * becomes ready.
       */
      viewer.removeEventListener(events.ReadyEvent.type, readyListener);

      viewer.destroy();

      if (viewerRef.current === viewer) {
        viewerRef.current = null;
      }
    };
  }, []);

  /*
   * Install the selected panorama while preserving the viewer's
   * current yaw, pitch, and zoom.
   */
  useEffect(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    if (currentImageUrlRef.current === imageUrl) {
      return;
    }

    const requestNumber = ++requestNumberRef.current;

    const startedAt = performance.now();

    /*
     * Read the authoritative pose directly from the viewer
     * immediately before changing the panorama.
     */
    const currentPosition = viewer.getPosition();

    const preservedPose: ViewerPose = {
      yaw: currentPosition.yaw,
      pitch: currentPosition.pitch,
      zoom: viewer.getZoomLevel(),
    };

    poseRef.current = preservedPose;
    panoramaChangingRef.current = true;

    setPanoramaLoading(true);
    setLoadError(null);

    console.debug("Panorama change started.", {
      imageUrl,
      requestNumber,
    });

    void viewer
      .setPanorama(imageUrl, {
        transition: false,

        /*
         * Apply the saved pose as part of the panorama change
         * instead of restoring it afterward.
         */
        position: {
          yaw: preservedPose.yaw,
          pitch: preservedPose.pitch,
        },

        zoom: preservedPose.zoom,

        /*
         * The component renders its own loading status.
         */
        showLoader: false,
      })
      .then(() => {
        /*
         * A newer request has replaced this panorama request.
         *
         * The older completion must not update refs or React state.
         */
        if (requestNumber !== requestNumberRef.current || !mountedRef.current) {
          console.debug("Superseded panorama request completed.", {
            imageUrl,
            requestNumber,
            currentRequestNumber: requestNumberRef.current,
            durationMs: Math.round(performance.now() - startedAt),
          });

          return;
        }

        currentImageUrlRef.current = imageUrl;
        panoramaChangingRef.current = false;

        console.debug("Panorama change completed.", {
          imageUrl,
          requestNumber,
          durationMs: Math.round(performance.now() - startedAt),
        });

        setPanoramaLoading(false);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        /*
         * Photo Sphere Viewer can reject an earlier operation when
         * a newer panorama replaces it.
         *
         * This is an expected superseded request, not an error that
         * should be displayed to the user.
         */
        if (requestNumber !== requestNumberRef.current || !mountedRef.current) {
          console.debug("Superseded panorama request ended.", {
            imageUrl,
            requestNumber,
            currentRequestNumber: requestNumberRef.current,
            durationMs: Math.round(performance.now() - startedAt),
            reason,
          });

          return;
        }

        panoramaChangingRef.current = false;

        const message = getLoadErrorMessage(reason, imageUrl);

        console.error("Current panorama failed to load.", {
          imageUrl,
          requestNumber,
          durationMs: Math.round(performance.now() - startedAt),
          reason,
        });

        setPanoramaLoading(false);
        setLoadError(message);
      });
  }, [imageUrl]);

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
