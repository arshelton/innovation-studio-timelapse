import { useEffect, useState } from "react";

import { loadManifest } from "../services/manifest";
import type { PanoramaManifest } from "../types";

interface ManifestState {
  manifest: PanoramaManifest | null;
  loading: boolean;
  error: Error | null;
}

export function useManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({
    manifest: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    loadManifest(controller.signal)
      .then((manifest) => {
        if (controller.signal.aborted) return;

        setState({ manifest, loading: false, error: null });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;

        const error =
          reason instanceof Error
            ? reason
            : new Error("An unknown manifest error occurred.");

        setState({ manifest: null, loading: false, error });
      });

    return () => {
      controller.abort();
    };
  }, []);

  return state;
}
