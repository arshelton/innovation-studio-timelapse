import { useEffect, useRef, useState } from "react";

import { events, Viewer } from "@photo-sphere-viewer/core";

import type { ViewerPose } from "../types";

interface Props {
  imageUrl: string;
  onPoseChange?: (pose: ViewerPose) => void;
}

export function PanoramaViewer({ imageUrl, onPoseChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const viewerRef = useRef<Viewer | null>(null);

  const poseRef = useRef<ViewerPose>({
    yaw: 0,
    pitch: 0,
    zoom: 50,
  });

  /*
   * Keep the callback in a ref so changing callback
   * identity does not recreate the third-party viewer.
   */
  const onPoseChangeRef = useRef(onPoseChange);

  const requestNumberRef = useRef(0);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    onPoseChangeRef.current = onPoseChange;
  }, [onPoseChange]);

  /*
   * Initialize the Photo Sphere Viewer instance once.
   */
  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const viewer = new Viewer({
      container,

      navbar: ["zoom", "move", "fullscreen"],

      mousewheelCtrlKey: false,
    });

    viewerRef.current = viewer;

    /*
     * An EventListenerObject avoids the generic callback
     * inference difference between addEventListener and
     * removeEventListener.
     */
    const positionListener: EventListenerObject = {
      handleEvent(event: Event): void {
        if (!(event instanceof events.PositionUpdatedEvent)) {
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
        if (!(event instanceof events.ZoomUpdatedEvent)) {
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

    viewer.addEventListener(events.PositionUpdatedEvent.type, positionListener);

    viewer.addEventListener(events.ZoomUpdatedEvent.type, zoomListener);

    return () => {
      /*
       * These are the same listener objects passed to
       * addEventListener.
       */
      viewer.removeEventListener(
        events.PositionUpdatedEvent.type,
        positionListener,
      );

      viewer.removeEventListener(events.ZoomUpdatedEvent.type, zoomListener);

      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  /*
   * Load a panorama whenever its URL changes.
   */
  useEffect(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    const requestNumber = ++requestNumberRef.current;

    const poseBeforeLoad = poseRef.current;

    setLoadError(null);

    viewer
      .setPanorama(imageUrl, {
        transition: false,
      })
      .then(() => {
        /*
         * Ignore stale responses when the timeline has
         * changed again before this image finished.
         */
        if (requestNumber !== requestNumberRef.current) {
          return;
        }

        viewer.rotate({
          yaw: poseBeforeLoad.yaw,
          pitch: poseBeforeLoad.pitch,
        });

        viewer.zoom(poseBeforeLoad.zoom);
      })
      .catch((reason: unknown) => {
        if (requestNumber !== requestNumberRef.current) {
          return;
        }

        const message =
          reason instanceof Error
            ? reason.message
            : "The panorama could not be loaded.";

        setLoadError(message);
      });
  }, [imageUrl]);

  return (
    <section className="viewer-shell">
      <div ref={containerRef} className="panorama-viewer" />

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
