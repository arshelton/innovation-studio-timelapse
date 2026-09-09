interface ImportMetaEnv {
  readonly VITE_IMAGE_BASE_URL: string;
  readonly VITE_FRAME_TOLERANCE_MINUTES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
