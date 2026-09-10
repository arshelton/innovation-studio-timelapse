import type { Location, PanoramaFrame, PanoramaManifest } from "../types";

function isLocation(value: unknown): value is Location {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return typeof candidate.id === "string" && typeof candidate.name === "string";
}

function isPanoramaFrame(value: unknown): value is PanoramaFrame {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.locationId === "string" &&
    typeof candidate.timestamp === "number" &&
    Number.isFinite(candidate.timestamp) &&
    typeof candidate.imagePath === "string"
  );
}

function isPanoramaManifest(value: unknown): value is PanoramaManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.locations) &&
    candidate.locations.every(isLocation) &&
    Array.isArray(candidate.frames) &&
    candidate.frames.every(isPanoramaFrame)
  );
}

export async function loadManifest(
  signal: AbortSignal,
): Promise<PanoramaManifest> {
  const manifestUrl = `${import.meta.env.BASE_URL}panorama-manifest.json`;

  const response = await fetch(manifestUrl, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`Manifest request failed with status ${response.status}`);
  }

  const value: unknown = await response.json();

  if (!isPanoramaManifest(value)) {
    throw new Error("The panorama manifest has an invalid structure.");
  }

  return value;
}

export function resolveFrameUrl(imagePath: string): string {
  const configuredBaseUrl = import.meta.env.VITE_IMAGE_BASE_URL;

  if (!configuredBaseUrl) {
    throw new Error("VITE_IMAGE_BASE_URL has not been configured.");
  }

  console.log(configuredBaseUrl);

  const baseUrl = configuredBaseUrl.replace(/\/_$/, "");
  const normalizedPath = imagePath.replace(/^\/+/, "");

  return `${baseUrl}/${normalizedPath}`;
}
