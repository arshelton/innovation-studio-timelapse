export interface ViewerPose {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface PanoramaManifest {
  generatedAt: string;
  locations: Location[];
  frames: PanoramaFrame[];
}

export interface TiledPanorama {
  width: number;
  cols: number;
  rows: number;
  basePath: string;
  tileDirectory: string;
}

export interface PanoramaFrame {
  id: string;
  timestamp: number;
  locationId: string;
  imagePath: string;
  panorama?: TiledPanorama;
}

export interface Location {
  id: string;
  name: string;
}
