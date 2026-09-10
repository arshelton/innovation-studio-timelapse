import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const projectRoot = path.resolve(currentDirectory, "..");

const sourceRoot = path.join(projectRoot, "source-panoramas");

const generatedRoot = path.join(projectRoot, "generated-panoramas", "tiles-v1");

const supportedImagePattern = /\.(jpe?g|png|webp)$/i;

const expectedWidth = 11904;
const expectedHeight = 5952;

const tileColumns = 16;
const tileRows = 8;

const tileWidth = expectedWidth / tileColumns;
const tileHeight = expectedHeight / tileRows;

const baseWidth = 2048;
const baseHeight = 1024;

const baseQuality = 78;
const tileQuality = 85;

const expectedTileCount = tileColumns * tileRows;

const commandLineArguments = process.argv.slice(2);

const forceRegeneration = commandLineArguments.includes("--force");

const requestedFileArgument = getArgumentValue("--file");

const requestedLocationArgument = getArgumentValue("--location");

function getArgumentValue(argumentName) {
  const argumentIndex = commandLineArguments.indexOf(argumentName);

  if (argumentIndex === -1) {
    return null;
  }

  const argumentValue = commandLineArguments[argumentIndex + 1];

  if (!argumentValue || argumentValue.startsWith("--")) {
    throw new Error(`A value is required after ${argumentName}.`);
  }

  return argumentValue;
}

function runCommand(command, argumentsList, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: projectRoot,
      windowsHide: true,
      stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let standardOutput = "";
    let standardError = "";

    if (options.captureOutput) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      child.stdout?.on("data", (chunk) => {
        standardOutput += chunk;
      });

      child.stderr?.on("data", (chunk) => {
        standardError += chunk;
      });
    }

    child.once("error", (error) => {
      reject(
        new Error(`Unable to start ${command}: ${error.message}`, {
          cause: error,
        }),
      );
    });

    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) {
        resolve({
          stdout: standardOutput.trim(),
          stderr: standardError.trim(),
        });

        return;
      }

      if (signal) {
        reject(new Error(`${command} was terminated by signal ${signal}.`));

        return;
      }

      const details = standardError.trim();

      reject(
        new Error(
          [`${command} exited with code ${exitCode}.`, details]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });
  });
}

async function verifyImageMagick() {
  try {
    const result = await runCommand("magick", ["-version"], {
      captureOutput: true,
    });

    const firstLine =
      result.stdout.split(/\r?\n/, 1)[0] ?? "ImageMagick detected";

    console.log(firstLine);
  } catch (reason) {
    throw new Error(
      [
        "ImageMagick could not be started.",
        "",
        "Install ImageMagick and ensure the magick",
        "command is available in your system PATH.",
        "",
        "After installation, verify it with:",
        "magick -version",
      ].join("\n"),
      {
        cause: reason,
      },
    );
  }
}

async function verifySourceRoot() {
  try {
    await access(sourceRoot);
  } catch {
    throw new Error(
      [
        "The source panorama directory was not found:",
        sourceRoot,
        "",
        "Expected a structure such as:",
        "source-panoramas/main/image.jpg",
      ].join("\n"),
    );
  }
}

async function getImageDimensions(imagePath) {
  const result = await runCommand(
    "magick",
    [imagePath, "-auto-orient", "-format", "%w %h", "info:"],
    {
      captureOutput: true,
    },
  );

  const match = result.stdout.match(/^(\d+)\s+(\d+)$/);

  if (!match) {
    throw new Error(
      [
        "ImageMagick returned unexpected dimensions.",
        `File: ${imagePath}`,
        `Output: ${result.stdout}`,
      ].join("\n"),
    );
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function validateImageDimensions(sourcePath, dimensions) {
  const { width, height } = dimensions;

  if (width !== height * 2) {
    throw new Error(
      [
        "The panorama is not a 2:1 equirectangular image.",
        `File: ${sourcePath}`,
        `Dimensions: ${width} x ${height}`,
      ].join("\n"),
    );
  }

  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      [
        "The panorama dimensions do not match the",
        "configured tile geometry.",
        "",
        `File: ${sourcePath}`,
        `Actual: ${width} x ${height}`,
        `Expected: ${expectedWidth} x ${expectedHeight}`,
      ].join("\n"),
    );
  }

  if (width % tileColumns !== 0 || height % tileRows !== 0) {
    throw new Error(
      [
        "The panorama cannot be divided evenly into",
        `${tileColumns} columns and ${tileRows} rows.`,
        "",
        `File: ${sourcePath}`,
        `Dimensions: ${width} x ${height}`,
      ].join("\n"),
    );
  }
}

async function directoryIsComplete(outputDirectory) {
  try {
    const baseFilePath = path.join(outputDirectory, "base.jpg");

    const baseFileStats = await stat(baseFilePath);

    if (!baseFileStats.isFile() || baseFileStats.size === 0) {
      return false;
    }

    const tilesDirectory = path.join(outputDirectory, "tiles");

    const tileEntries = await readdir(tilesDirectory, {
      withFileTypes: true,
    });

    const tileNames = tileEntries
      .filter((entry) => {
        return entry.isFile() && /^\d+_\d+\.jpg$/i.test(entry.name);
      })
      .map((entry) => entry.name);

    if (tileNames.length !== expectedTileCount) {
      return false;
    }

    for (let row = 0; row < tileRows; row += 1) {
      for (let column = 0; column < tileColumns; column += 1) {
        const expectedName = `${column}_${row}.jpg`;

        if (!tileNames.includes(expectedName)) {
          return false;
        }

        const tileStats = await stat(path.join(tilesDirectory, expectedName));

        if (!tileStats.isFile() || tileStats.size === 0) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function generateBaseImage(sourcePath, destinationPath) {
  await runCommand("magick", [
    sourcePath,
    "-auto-orient",
    "-resize",
    `${baseWidth}x${baseHeight}!`,
    "-strip",
    "-colorspace",
    "sRGB",
    "-sampling-factor",
    "4:2:0",
    "-interlace",
    "Plane",
    "-quality",
    String(baseQuality),
    destinationPath,
  ]);
}

async function generateTemporaryTiles(sourcePath, temporaryTilesDirectory) {
  const temporaryTilePattern = path.join(
    temporaryTilesDirectory,
    "tile-%d.jpg",
  );

  await runCommand("magick", [
    sourcePath,
    "-auto-orient",
    "-crop",
    `${tileWidth}x${tileHeight}`,
    "+repage",
    "-strip",
    "-colorspace",
    "sRGB",
    "-sampling-factor",
    "4:2:0",
    "-interlace",
    "Plane",
    "-quality",
    String(tileQuality),
    temporaryTilePattern,
  ]);
}

async function renameGeneratedTiles(temporaryTilesDirectory) {
  const generatedEntries = await readdir(temporaryTilesDirectory, {
    withFileTypes: true,
  });

  const generatedTileNames = generatedEntries
    .filter((entry) => {
      return entry.isFile() && /^tile-\d+\.jpg$/i.test(entry.name);
    })
    .map((entry) => entry.name)
    .sort((firstName, secondName) => {
      const firstIndex = Number(firstName.match(/\d+/)?.[0] ?? -1);

      const secondIndex = Number(secondName.match(/\d+/)?.[0] ?? -1);

      return firstIndex - secondIndex;
    });

  if (generatedTileNames.length !== expectedTileCount) {
    throw new Error(
      [
        "ImageMagick generated an unexpected",
        "number of tiles.",
        "",
        `Expected: ${expectedTileCount}`,
        `Generated: ${generatedTileNames.length}`,
      ].join("\n"),
    );
  }

  for (
    let tileIndex = 0;
    tileIndex < generatedTileNames.length;
    tileIndex += 1
  ) {
    const column = tileIndex % tileColumns;
    const row = Math.floor(tileIndex / tileColumns);

    const currentPath = path.join(
      temporaryTilesDirectory,
      generatedTileNames[tileIndex],
    );

    const finalPath = path.join(
      temporaryTilesDirectory,
      `${column}_${row}.jpg`,
    );

    await rename(currentPath, finalPath);
  }
}

async function processPanorama(locationId, imageName) {
  const sourcePath = path.join(sourceRoot, locationId, imageName);

  const panoramaName = path.parse(imageName).name;

  const outputDirectory = path.join(generatedRoot, locationId, panoramaName);

  if (!forceRegeneration && (await directoryIsComplete(outputDirectory))) {
    console.log(`Skipping completed panorama: ${locationId}/${imageName}`);

    return "skipped";
  }

  console.log("");
  console.log(`Processing ${locationId}/${imageName}`);

  const dimensions = await getImageDimensions(sourcePath);

  validateImageDimensions(sourcePath, dimensions);

  const temporaryDirectory = `${outputDirectory}.temporary`;

  const temporaryTilesDirectory = path.join(temporaryDirectory, "tiles");

  /*
   * Delete an incomplete temporary directory from a previous run.
   */
  await rm(temporaryDirectory, {
    recursive: true,
    force: true,
  });

  await mkdir(temporaryTilesDirectory, {
    recursive: true,
  });

  try {
    console.log(`Creating ${baseWidth} x ${baseHeight} base panorama`);

    await generateBaseImage(
      sourcePath,
      path.join(temporaryDirectory, "base.jpg"),
    );

    console.log(
      [
        `Creating ${tileColumns} x ${tileRows}`,
        `tile grid at ${tileWidth} x ${tileHeight}`,
      ].join(" "),
    );

    await generateTemporaryTiles(sourcePath, temporaryTilesDirectory);

    await renameGeneratedTiles(temporaryTilesDirectory);

    const temporaryComplete = await directoryIsComplete(temporaryDirectory);

    if (!temporaryComplete) {
      throw new Error("Generated panorama verification failed.");
    }

    /*
     * Replace an existing output only after the new panorama has
     * been generated and verified successfully.
     */
    await rm(outputDirectory, {
      recursive: true,
      force: true,
    });

    await mkdir(path.dirname(outputDirectory), {
      recursive: true,
    });

    await rename(temporaryDirectory, outputDirectory);

    console.log(`Completed ${locationId}/${panoramaName}`);

    return "generated";
  } catch (reason) {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });

    throw reason;
  }
}

async function discoverPanoramas() {
  const rootEntries = await readdir(sourceRoot, {
    withFileTypes: true,
  });

  const locationDirectories = rootEntries
    .filter((entry) => {
      return entry.isDirectory() && !entry.name.startsWith(".");
    })
    .sort((firstEntry, secondEntry) => {
      return firstEntry.name.localeCompare(secondEntry.name);
    });

  const panoramas = [];

  for (const locationDirectory of locationDirectories) {
    const locationId = locationDirectory.name;

    if (
      requestedLocationArgument !== null &&
      requestedLocationArgument !== locationId
    ) {
      continue;
    }

    const locationPath = path.join(sourceRoot, locationId);

    const imageEntries = await readdir(locationPath, {
      withFileTypes: true,
    });

    const imageNames = imageEntries
      .filter((entry) => {
        return entry.isFile() && supportedImagePattern.test(entry.name);
      })
      .map((entry) => entry.name)
      .sort((firstName, secondName) => {
        return firstName.localeCompare(secondName);
      });

    for (const imageName of imageNames) {
      if (
        requestedFileArgument !== null &&
        requestedFileArgument !== imageName
      ) {
        continue;
      }

      panoramas.push({
        locationId,
        imageName,
      });
    }
  }

  return panoramas;
}

async function generateTiles() {
  await verifySourceRoot();
  await verifyImageMagick();

  if (!Number.isInteger(tileWidth)) {
    throw new Error(
      [
        "The configured width cannot be divided evenly",
        `into ${tileColumns} columns.`,
      ].join("\n"),
    );
  }

  if (!Number.isInteger(tileHeight)) {
    throw new Error(
      [
        "The configured height cannot be divided evenly",
        `into ${tileRows} rows.`,
      ].join("\n"),
    );
  }

  await mkdir(generatedRoot, {
    recursive: true,
  });

  const panoramas = await discoverPanoramas();

  if (panoramas.length === 0) {
    throw new Error(
      [
        "No matching source panoramas were found.",
        "",
        requestedLocationArgument
          ? `Location filter: ${requestedLocationArgument}`
          : "",
        requestedFileArgument ? `File filter: ${requestedFileArgument}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  console.log("");
  console.log(`Found ${panoramas.length} panorama(s).`);

  console.log(
    [
      `Tile configuration: ${tileColumns} x ${tileRows}`,
      `(${tileWidth} x ${tileHeight} pixels each)`,
    ].join(" "),
  );

  let generatedCount = 0;
  let skippedCount = 0;

  for (const panorama of panoramas) {
    const result = await processPanorama(
      panorama.locationId,
      panorama.imageName,
    );

    if (result === "generated") {
      generatedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  console.log("");
  console.log("Tile generation complete.");
  console.log(`Generated: ${generatedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Output: ${generatedRoot}`);
}

generateTiles().catch((reason) => {
  console.error("");
  console.error("Tile generation failed.");

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
