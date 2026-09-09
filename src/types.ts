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

export interface PanoramaFrame {
  id: string;
  timestamp: number;
  locationId: string;
  imagePath: string;
}

export interface Location {
  id: string;
  name: string;
}
