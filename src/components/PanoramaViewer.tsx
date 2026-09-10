import { useEffect, useRef, useState } from "react";

import { events, Viewer } from "@photo-sphere-viewer/core";

import type { ViewerPose } from "../types";

interface PanoramaViewerProps {
  imageUrl: string;

  onPoseChange?: (pose: ViewerPose) => void;
}

export function PanoramaViewer({
  imageUrl,
  onPoseChange,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const viewerRef = useRef<Viewer | null>(null);

  const currentImageUrlRef = useRef(imageUrl);

  const onPoseChangeRef = useRef(onPoseChange);

  const poseRef = useRef<ViewerPose>({
    yaw: 0,
    pitch: 0,
    zoom: 50,
  });

  /*
   * Loading another panorama may produce programmatic
   * position and zoom events.
   *
   * Those events must not replace the user's saved pose.
   */
  const panoramaChangingRef = useRef(false);

  /*
   * Prevent stale panorama completions from updating the
   * component after a newer selection.
   */
  const requestNumberRef = useRef(0);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [panoramaLoading, setPanoramaLoading] = useState(false);

  useEffect(() => {
    onPoseChangeRef.current = onPoseChange;
  }, [onPoseChange]);

  /*
   * Create one long-lived Photo Sphere Viewer instance.
   */
  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

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
        const position = viewer.getPosition();

        poseRef.current = {
          yaw: position.yaw,
          pitch: position.pitch,
          zoom: viewer.getZoomLevel(),
        };

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
      viewer.removeEventListener(
        events.PositionUpdatedEvent.type,
        positionListener,
      );

      viewer.removeEventListener(events.ZoomUpdatedEvent.type, zoomListener);

      viewer.destroy();
      viewerRef.current = null;
    };

    /*
     * Later image changes are handled by the separate
     * imageUrl effect.
     */
  }, []);

  /*
   * Install the newly selected panorama while preserving
   * the user's exact yaw, pitch, and zoom.
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

    /*
     * Read the authoritative pose directly from the
     * viewer immediately before changing the panorama.
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

    viewer
      .setPanorama(imageUrl, {
        transition: false,

        /*
         * Apply the desired position during the panorama
         * change itself.
         */
        position: {
          yaw: preservedPose.yaw,
          pitch: preservedPose.pitch,
        },

        zoom: preservedPose.zoom,

        /*
         * We render our own smaller status indicator.
         */
        showLoader: false,
      })
      .then(() => {
        if (requestNumber !== requestNumberRef.current) {
          return;
        }

        currentImageUrlRef.current = imageUrl;
        panoramaChangingRef.current = false;

        setPanoramaLoading(false);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (requestNumber !== requestNumberRef.current) {
          return;
        }

        panoramaChangingRef.current = false;

        const message =
          reason instanceof Error
            ? reason.message
            : "The panorama could not be loaded.";

        console.error("Panorama loading failed.", {
          imageUrl,
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
        <div className="viewer-loading-status" role="status">
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
