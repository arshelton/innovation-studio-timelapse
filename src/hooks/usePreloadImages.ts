import { useEffect } from "react";

export function usePreloadImages(imageUrls: string[]): void {
  useEffect(() => {
    const images = imageUrls.map((imageUrl) => {
      const image = new Image();

      /*
       * This must be assigned before src.
       *
       * It causes the preload request to use CORS,
       * matching Photo Sphere Viewer's later request.
       */
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.src = imageUrl;

      return image;
    });

    return () => {
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [imageUrls]);
}
