import { useEffect, useRef, useState } from "react";

import { events, Viewer } from "@photo-sphere-viewer/core";

import { EquirectangularTilesAdapter } from "@photo-sphere-viewer/equirectangular-tiles-adapter";

import type { ViewerPose } from "../types";

export interface TiledPanoramaSource {
  id: string;
  width: number;
  cols: number;
  rows: number;
  baseUrl: string;
  tileDirectoryUrl: string;
  fallbackUrl: string;
}

interface PanoramaViewerProps {
  panorama: TiledPanoramaSource;
  onPoseChange?: (pose: ViewerPose) => void;
}

function createPanoramaConfiguration(panorama: TiledPanoramaSource) {
  const tileDirectory = panorama.tileDirectoryUrl.replace(/\/+$/, "");

  return {
    width: panorama.width,
    cols: panorama.cols,
    rows: panorama.rows,
    baseUrl: panorama.baseUrl,
    tileUrl: (column: number, row: number): string => {
      return `${tileDirectory}/${column}_${row}.jpg`;
    },
  };
}

function getLoadErrorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }

  if (reason instanceof Event && reason.target instanceof HTMLImageElement) {
    return (
      reason.target.currentSrc ||
      reason.target.src ||
      "The panorama could not be loaded."
    );
  }

  return "The panorama could not be loaded.";
}

export function PanoramaViewer({
  panorama,
  onPoseChange,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const viewerRef = useRef<Viewer | null>(null);

  const mountedRef = useRef(false);

  const currentPanoramaIdRef = useRef<string | null>(null);

  const requestIdRef = useRef(0);

  const panoramaChangingRef = useRef(false);

  const initialPanoramaRef = useRef(panorama);

  const onPoseChangeRef = useRef(onPoseChange);

  const poseRef = useRef<ViewerPose>({
    yaw: 0,
    pitch: 0,
    zoom: 50,
  });

  const [panoramaLoading, setPanoramaLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    onPoseChangeRef.current = onPoseChange;
  }, [onPoseChange]);

  /*
   * Create viewer once.
   */
  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    mountedRef.current = true;

    const initialPanorama = initialPanoramaRef.current;

    currentPanoramaIdRef.current = initialPanorama.id;

    const viewer = new Viewer({
      container,
      adapter: EquirectangularTilesAdapter,
      panorama: createPanoramaConfiguration(initialPanorama),
      navbar: ["zoom", "move", "fullscreen"],
      defaultZoomLvl: poseRef.current.zoom,
      mousewheelCtrlKey: false,
    });

    viewerRef.current = viewer;

    const positionListener: EventListenerObject = {
      handleEvent(event: Event) {
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
      handleEvent(event: Event) {
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
      handleEvent() {
        if (!mountedRef.current) {
          return;
        }

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
      mountedRef.current = false;

      viewer.removeEventListener(
        events.PositionUpdatedEvent.type,
        positionListener,
      );

      viewer.removeEventListener(events.ZoomUpdatedEvent.type, zoomListener);

      viewer.removeEventListener(events.ReadyEvent.type, readyListener);

      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  /*
   * Change panoramas.
   */
  useEffect(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    if (currentPanoramaIdRef.current === panorama.id) {
      return;
    }

    const requestId = ++requestIdRef.current;

    const position = viewer.getPosition();

    const preservedPose: ViewerPose = {
      yaw: position.yaw,
      pitch: position.pitch,
      zoom: viewer.getZoomLevel(),
    };

    poseRef.current = preservedPose;

    panoramaChangingRef.current = true;

    setPanoramaLoading(true);
    setLoadError(null);

    console.debug("Loading tiled panorama", panorama.id);

    void viewer
      .setPanorama(createPanoramaConfiguration(panorama), {
        transition: false,
        position: {
          yaw: preservedPose.yaw,
          pitch: preservedPose.pitch,
        },
        zoom: preservedPose.zoom,
        showLoader: false,
      })
      .then(() => {
        if (!mountedRef.current) {
          return;
        }

        if (requestId !== requestIdRef.current) {
          return;
        }

        currentPanoramaIdRef.current = panorama.id;

        panoramaChangingRef.current = false;

        setPanoramaLoading(false);
        setLoadError(null);
      })
      .catch((reason) => {
        if (!mountedRef.current) {
          return;
        }

        /*
         * Ignore stale requests.
         */
        if (requestId !== requestIdRef.current) {
          return;
        }

        panoramaChangingRef.current = false;

        setPanoramaLoading(false);

        setLoadError(getLoadErrorMessage(reason));
      });
  }, [panorama]);

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
