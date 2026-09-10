import { access, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);

const currentDirectory = path.dirname(currentFilePath);

const projectRoot = path.resolve(currentDirectory, "..");

const tileVersion = "tiles-v1";

const generatedRoot = path.join(
  projectRoot,
  "generated-panoramas",
  tileVersion,
);

const wranglerPath = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

const expectedColumns = 16;
const expectedRows = 8;
const expectedTileCount = expectedColumns * expectedRows;

const cacheControl = "public, max-age=31536000, immutable";

const bucketName = process.argv[2];
const commandArguments = process.argv.slice(3);

const requestedLocation = getArgumentValue("--location");

const requestedFile = getArgumentValue("--file");

function getArgumentValue(argumentName) {
  const argumentIndex = commandArguments.indexOf(argumentName);

  if (argumentIndex === -1) {
    return null;
  }

  const value = commandArguments[argumentIndex + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`A value is required after ${argumentName}.`);
  }

  return value;
}

if (!bucketName) {
  throw new Error(
    [
      "An R2 bucket name is required.",
      "",
      "Upload every generated panorama:",
      "npm run upload:r2 -- panorama-viewer-images",
      "",
      "Upload one panorama:",
      [
        "npm run upload:r2 --",
        "panorama-viewer-images",
        "--location main",
        "--file IMG_20260203_170733_00_005.jpg",
      ].join(" "),
    ].join("\n"),
  );
}

async function verifyRequiredPaths() {
  try {
    await access(generatedRoot);
  } catch {
    throw new Error(
      [
        "The generated panorama directory was not found:",
        generatedRoot,
        "",
        "Generate tiled panoramas before uploading them.",
      ].join("\n"),
    );
  }

  try {
    await access(wranglerPath);
  } catch {
    throw new Error(
      [
        "The local Wrangler installation was not found:",
        wranglerPath,
        "",
        "Install it with:",
        "npm install --save-dev wrangler",
      ].join("\n"),
    );
  }
}

function runWrangler(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerPath, ...argumentsList], {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", (error) => {
      reject(
        new Error(`Unable to start Wrangler: ${error.message}`, {
          cause: error,
        }),
      );
    });

    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`Wrangler was terminated by signal ${signal}.`));

        return;
      }

      reject(new Error(`Wrangler exited with code ${exitCode}.`));
    });
  });
}

async function verifyFile(filePath) {
  try {
    const fileStats = await stat(filePath);

    return fileStats.isFile() && fileStats.size > 0;
  } catch {
    return false;
  }
}

async function getPanoramaFiles(panoramaDirectory) {
  const basePath = path.join(panoramaDirectory, "base.jpg");

  if (!(await verifyFile(basePath))) {
    throw new Error(`Missing or empty base panorama: ${basePath}`);
  }

  const tilesDirectory = path.join(panoramaDirectory, "tiles");

  let tileEntries;

  try {
    tileEntries = await readdir(tilesDirectory, {
      withFileTypes: true,
    });
  } catch {
    throw new Error(`Tile directory was not found: ${tilesDirectory}`);
  }

  const tileNames = tileEntries
    .filter((entry) => {
      return entry.isFile() && /^\d+_\d+\.jpg$/i.test(entry.name);
    })
    .map((entry) => entry.name);

  if (tileNames.length !== expectedTileCount) {
    throw new Error(
      [
        "The generated panorama has an incorrect tile count.",
        `Directory: ${tilesDirectory}`,
        `Expected: ${expectedTileCount}`,
        `Found: ${tileNames.length}`,
      ].join("\n"),
    );
  }

  const tileFiles = [];

  for (let row = 0; row < expectedRows; row += 1) {
    for (let column = 0; column < expectedColumns; column += 1) {
      const tileName = `${column}_${row}.jpg`;

      const tilePath = path.join(tilesDirectory, tileName);

      if (!(await verifyFile(tilePath))) {
        throw new Error(`Missing or empty tile: ${tilePath}`);
      }

      tileFiles.push({
        localPath: tilePath,
        relativePath: ["tiles", tileName].join("/"),
      });
    }
  }

  return [
    {
      localPath: basePath,
      relativePath: "base.jpg",
    },
    ...tileFiles,
  ];
}

async function discoverPanoramas() {
  const rootEntries = await readdir(generatedRoot, {
    withFileTypes: true,
  });

  const locationEntries = rootEntries
    .filter((entry) => {
      return entry.isDirectory() && !entry.name.startsWith(".");
    })
    .sort((firstEntry, secondEntry) => {
      return firstEntry.name.localeCompare(secondEntry.name);
    });

  const panoramas = [];

  for (const locationEntry of locationEntries) {
    const locationId = locationEntry.name;

    if (requestedLocation !== null && requestedLocation !== locationId) {
      continue;
    }

    const locationDirectory = path.join(generatedRoot, locationId);

    const panoramaEntries = await readdir(locationDirectory, {
      withFileTypes: true,
    });

    const panoramaDirectories = panoramaEntries
      .filter((entry) => {
        return (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !entry.name.endsWith(".temporary")
        );
      })
      .sort((firstEntry, secondEntry) => {
        return firstEntry.name.localeCompare(secondEntry.name);
      });

    for (const panoramaEntry of panoramaDirectories) {
      const panoramaName = panoramaEntry.name;

      /*
       * The --file argument may include the original extension,
       * while generated panorama directories use the filename stem.
       */
      const requestedPanoramaName =
        requestedFile === null ? null : path.parse(requestedFile).name;

      if (
        requestedPanoramaName !== null &&
        requestedPanoramaName !== panoramaName
      ) {
        continue;
      }

      panoramas.push({
        locationId,
        panoramaName,
        directory: path.join(locationDirectory, panoramaName),
      });
    }
  }

  return panoramas;
}

async function uploadFile(localPath, objectKey) {
  console.log(`Uploading ${objectKey}`);

  await runWrangler([
    "r2",
    "object",
    "put",
    `${bucketName}/${objectKey}`,
    "--file",
    localPath,
    "--content-type",
    "image/jpeg",
    "--cache-control",
    cacheControl,
    "--remote",
    "--jurisdiction",
    "us",
  ]);
}

async function uploadPanorama(panorama) {
  console.log("");
  console.log(
    ["Preparing", `${panorama.locationId}/`, panorama.panoramaName].join(""),
  );

  const files = await getPanoramaFiles(panorama.directory);

  let uploadedCount = 0;

  for (const file of files) {
    const objectKey = [
      tileVersion,
      panorama.locationId,
      panorama.panoramaName,
      file.relativePath,
    ].join("/");

    await uploadFile(file.localPath, objectKey);

    uploadedCount += 1;
  }

  console.log(
    [
      "Completed",
      `${panorama.locationId}/`,
      `${panorama.panoramaName}:`,
      `${uploadedCount} files uploaded.`,
    ].join(" "),
  );

  return uploadedCount;
}

async function uploadGeneratedPanoramas() {
  await verifyRequiredPaths();

  const panoramas = await discoverPanoramas();

  if (panoramas.length === 0) {
    throw new Error(
      [
        "No matching generated panoramas were found.",
        "",
        requestedLocation ? `Location filter: ${requestedLocation}` : "",
        requestedFile ? `File filter: ${requestedFile}` : "",
        "",
        `Generated root: ${generatedRoot}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  console.log("");
  console.log(`Found ${panoramas.length} panorama(s) to upload.`);

  console.log(`Destination bucket: ${bucketName}`);

  let totalUploadedCount = 0;
  let completedPanoramaCount = 0;

  for (const panorama of panoramas) {
    const uploadedCount = await uploadPanorama(panorama);

    totalUploadedCount += uploadedCount;
    completedPanoramaCount += 1;
  }

  console.log("");
  console.log("R2 upload complete.");

  console.log(`Panoramas uploaded: ${completedPanoramaCount}`);

  console.log(`Files uploaded: ${totalUploadedCount}`);
}

uploadGeneratedPanoramas().catch((reason) => {
  console.error("");
  console.error("R2 upload failed.");

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
