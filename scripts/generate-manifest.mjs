import { access, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const projectRoot = path.resolve(currentDirectory, "..");

const sourceRoot = path.join(projectRoot, "source-panoramas");

const generatedRoot = path.join(projectRoot, "generated-panoramas", "tiles-v1");

const output = path.join(projectRoot, "public", "panorama-manifest.json");

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const panoramaWidth = 11904;
const panoramaHeight = 5952;

const tileColumns = 16;
const tileRows = 8;

const expectedTileCount = tileColumns * tileRows;

function timestampFromName(name) {
  const match = name.match(
    /^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_\d{2}_\d{3}\.(?:jpe?g|png|webp)$/i,
  );

  if (!match) {
    throw new Error(`Filename does not follow expected format: ${name}`);
  }

  const [, year, month, day, hours, minutes, seconds] = match;

  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );

  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid timestamp in filename: ${name}`);
  }

  return timestamp;
}

function createLocationName(locationId) {
  return locationId
    .split(/[-_]/)
    .map((part) => {
      return part[0]?.toUpperCase() + part.slice(1);
    })
    .join(" ");
}

async function verifyDirectory(directoryPath) {
  try {
    const directoryStats = await stat(directoryPath);

    return directoryStats.isDirectory();
  } catch {
    return false;
  }
}

async function verifyFile(filePath) {
  try {
    const fileStats = await stat(filePath);

    return fileStats.isFile() && fileStats.size > 0;
  } catch {
    return false;
  }
}

async function verifyGeneratedPanorama(locationId, panoramaName) {
  const panoramaDirectory = path.join(generatedRoot, locationId, panoramaName);

  const baseFilePath = path.join(panoramaDirectory, "base.jpg");

  const tilesDirectory = path.join(panoramaDirectory, "tiles");

  if (!(await verifyDirectory(panoramaDirectory))) {
    return {
      complete: false,
      reason: "Generated panorama directory was not found.",
    };
  }

  if (!(await verifyFile(baseFilePath))) {
    return {
      complete: false,
      reason: "Generated base panorama was not found or was empty.",
    };
  }

  if (!(await verifyDirectory(tilesDirectory))) {
    return {
      complete: false,
      reason: "Generated tile directory was not found.",
    };
  }

  const tileEntries = await readdir(tilesDirectory, {
    withFileTypes: true,
  });

  const producedTileNames = new Set(
    tileEntries
      .filter((entry) => {
        return entry.isFile() && /^\d+_\d+\.jpg$/i.test(entry.name);
      })
      .map((entry) => entry.name),
  );

  if (producedTileNames.size !== expectedTileCount) {
    return {
      complete: false,
      reason: [
        "Generated tile count is incorrect.",
        `Expected ${expectedTileCount},`,
        `found ${producedTileNames.size}.`,
      ].join(" "),
    };
  }

  for (let row = 0; row < tileRows; row += 1) {
    for (let column = 0; column < tileColumns; column += 1) {
      const tileName = `${column}_${row}.jpg`;

      if (!producedTileNames.has(tileName)) {
        return {
          complete: false,
          reason: `Generated tile is missing: ${tileName}`,
        };
      }

      const tilePath = path.join(tilesDirectory, tileName);

      if (!(await verifyFile(tilePath))) {
        return {
          complete: false,
          reason: `Generated tile is empty: ${tileName}`,
        };
      }
    }
  }

  return {
    complete: true,
    reason: null,
  };
}

async function generateManifest() {
  try {
    await access(sourceRoot);
  } catch {
    throw new Error(
      ["The source panorama directory was not found:", sourceRoot].join("\n"),
    );
  }

  const locationEntries = (
    await readdir(sourceRoot, {
      withFileTypes: true,
    })
  )
    .filter((entry) => {
      return entry.isDirectory() && !entry.name.startsWith(".");
    })
    .sort((firstEntry, secondEntry) => {
      return firstEntry.name.localeCompare(secondEntry.name);
    });

  const locations = [];
  const frames = [];

  let tiledFrameCount = 0;
  let fallbackFrameCount = 0;

  for (const locationEntry of locationEntries) {
    const locationId = locationEntry.name;

    locations.push({
      id: locationId,
      name: createLocationName(locationId),
    });

    const locationPath = path.join(sourceRoot, locationId);

    const imageEntries = await readdir(locationPath, {
      withFileTypes: true,
    });

    const imageNames = imageEntries
      .filter((entry) => {
        if (!entry.isFile()) {
          return false;
        }

        const extension = path.extname(entry.name).toLowerCase();

        return supportedExtensions.has(extension);
      })
      .map((entry) => entry.name)
      .sort((firstName, secondName) => {
        return firstName.localeCompare(secondName);
      });

    for (const imageName of imageNames) {
      const panoramaName = path.parse(imageName).name;

      const generatedPanorama = await verifyGeneratedPanorama(
        locationId,
        panoramaName,
      );

      const frame = {
        id: `${locationId}:${imageName}`,
        locationId,
        timestamp: timestampFromName(imageName),

        /*
         * Keep the original image path during migration.
         *
         * The application can use it as a fallback if tiled assets
         * have not been generated for this frame yet.
         */
        imagePath: `${locationId}/${imageName}`,
      };

      if (generatedPanorama.complete) {
        frame.panorama = {
          width: panoramaWidth,
          cols: tileColumns,
          rows: tileRows,
          basePath: ["tiles-v1", locationId, panoramaName, "base.jpg"].join(
            "/",
          ),
          tileDirectory: ["tiles-v1", locationId, panoramaName, "tiles"].join(
            "/",
          ),
        };

        tiledFrameCount += 1;
      } else {
        fallbackFrameCount += 1;

        console.warn(
          [
            "Tiled assets are incomplete for",
            `${locationId}/${imageName}.`,
            generatedPanorama.reason,
            "The manifest will retain only the original image path.",
          ].join(" "),
        );
      }

      frames.push(frame);
    }
  }

  frames.sort((firstFrame, secondFrame) => {
    return (
      firstFrame.timestamp - secondFrame.timestamp ||
      firstFrame.locationId.localeCompare(secondFrame.locationId)
    );
  });

  locations.sort((firstLocation, secondLocation) => {
    return firstLocation.name.localeCompare(secondLocation.name);
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    locations,
    frames,
  };

  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`Wrote ${frames.length} frames to ${output}`);
  console.log(`Frames with tiled assets: ${tiledFrameCount}`);
  console.log(`Frames using original-image fallback: ${fallbackFrameCount}`);
}

generateManifest().catch((reason) => {
  console.error("");
  console.error("Manifest generation failed.");

  if (reason instanceof Error) {
    console.error(reason.message);

    if (reason.cause) {
      console.error(reason.cause);
    }
  } else {
    console.error(reason);
  }

  process.exitCode = 1;
});
