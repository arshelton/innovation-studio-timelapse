import { access, readdir } from "node:fs/promises";

import { spawn } from "node:child_process";

import path from "node:path";

import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);

const currentDirectory = path.dirname(currentFilePath);

const projectRoot = path.resolve(currentDirectory, "..");

const sourceRoot = path.join(projectRoot, "source-panoramas");

const wranglerPath = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

const supportedImagePattern = /\.(jpe?g|png|webp)$/i;

const bucketName = process.argv[2];

if (!bucketName) {
  throw new Error(
    [
      "An R2 bucket name is required.",
      "",
      "Example:",
      "npm run upload:r2 -- panorama-viewer-images",
    ].join("\n"),
  );
}

async function verifyRequiredPaths() {
  try {
    await access(sourceRoot);
  } catch {
    throw new Error(
      [
        "The source panorama directory was not found:",
        sourceRoot,
        "",
        "Create source-panoramas and add one",
        "subdirectory for each location.",
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
    /*
     * process.execPath is the absolute path to the
     * currently running Node executable.
     *
     * This avoids spawning npx.cmd on Windows.
     */
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

async function uploadImages() {
  await verifyRequiredPaths();

  const rootEntries = await readdir(sourceRoot, {
    withFileTypes: true,
  });

  const locationDirectories = rootEntries.filter((entry) => {
    return entry.isDirectory() && !entry.name.startsWith(".");
  });

  if (locationDirectories.length === 0) {
    throw new Error(
      [
        "No location directories were found under:",
        sourceRoot,
        "",
        "Expected a structure such as:",
        "source-panoramas/location-1/image.jpg",
      ].join("\n"),
    );
  }

  let uploadedCount = 0;
  let skippedCount = 0;

  for (const locationDirectory of locationDirectories) {
    const locationId = locationDirectory.name;

    const locationPath = path.join(sourceRoot, locationId);

    const imageEntries = await readdir(locationPath, {
      withFileTypes: true,
    });

    for (const imageEntry of imageEntries) {
      if (
        !imageEntry.isFile() ||
        !supportedImagePattern.test(imageEntry.name)
      ) {
        skippedCount += 1;
        continue;
      }

      const localFilePath = path.join(locationPath, imageEntry.name);

      /*
       * R2 object keys use forward slashes even when
       * this script is running on Windows.
       */
      const objectKey = [locationId, imageEntry.name].join("/");

      console.log("");
      console.log(`Uploading ${objectKey}`);

      await runWrangler([
        "r2",
        "object",
        "put",
        `${bucketName}/${objectKey}`,
        "--file",
        localFilePath,
        "--remote",
        "--jurisdiction",
        "us",
      ]);

      uploadedCount += 1;
    }
  }

  console.log("");
  console.log(`Uploaded ${uploadedCount} images.`);

  if (skippedCount > 0) {
    console.log(`Skipped ${skippedCount} non-image entries.`);
  }
}

uploadImages().catch((reason) => {
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
