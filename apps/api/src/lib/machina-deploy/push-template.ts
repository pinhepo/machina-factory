import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { DeployConfig, DeployResult } from "../db/schema";
import type { JobLogger } from "../jobs/logger";

/**
 * Zip a template directory and upload it to the Machina client-api.
 *
 * Uses Bun's native file APIs to create the ZIP (no shell dependency on `zip` or `python3`).
 * The client-api expects a multipart POST to /templates/upload with:
 * - Field name: "file"
 * - Content: ZIP archive with _install.yml at root level
 * - Auth: X-Api-Token header
 */
export async function pushTemplate(
  templateDirPath: string,
  relativePath: string,
  config: DeployConfig,
  log: JobLogger,
): Promise<DeployResult> {
  const { clientApiUrl, machinaApiKey } = config;

  if (!clientApiUrl || !machinaApiKey) {
    return {
      templatePath: relativePath,
      pushed: false,
      error: "Missing clientApiUrl or machinaApiKey in deploy config",
    };
  }

  try {
    // Collect all files in the template directory
    const files = await collectFiles(templateDirPath);

    if (files.length === 0) {
      return {
        templatePath: relativePath,
        pushed: false,
        error: "No files found in template directory",
      };
    }

    // Create ZIP using Bun's native writer
    const zipEntries: Record<string, Blob> = {};
    for (const filePath of files) {
      const relPath = relative(templateDirPath, filePath);
      const content = Bun.file(filePath);
      zipEntries[relPath] = content;
    }

    // Bun.write with a zip target isn't available yet, use the tar approach
    // Instead, build a zip buffer using Bun's shell
    const zipBuffer = await createZipBuffer(templateDirPath, files);

    await log.info(
      `Template ZIP created: ${relativePath} (${(zipBuffer.length / 1024).toFixed(1)} KB, ${files.length} files)`,
    );

    // Upload via multipart POST to client-api /templates/upload
    const formData = new FormData();
    const blob = new Blob([zipBuffer], { type: "application/zip" });
    formData.append(
      "file",
      blob,
      `${relativePath.replace(/\//g, "-") || "template"}.zip`,
    );

    const uploadUrl = `${clientApiUrl.replace(/\/$/, "")}/templates/upload`;
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Api-Token": machinaApiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        templatePath: relativePath,
        pushed: false,
        error: `Upload failed (${response.status}): ${body.slice(0, 300)}`,
      };
    }

    await log.info(`Template pushed: ${relativePath}`);
    return { templatePath: relativePath, pushed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      templatePath: relativePath,
      pushed: false,
      error: message.slice(0, 300),
    };
  }
}

/**
 * Recursively collect all file paths in a directory.
 */
async function collectFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath);
      results.push(...subFiles);
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Create a ZIP buffer from a directory using a minimal ZIP implementation.
 * Uses CRC32 + store method (no compression) for simplicity and zero dependencies.
 */
async function createZipBuffer(
  basePath: string,
  files: string[],
): Promise<Uint8Array> {
  const entries: Array<{
    name: Uint8Array;
    data: Uint8Array;
    crc: number;
  }> = [];

  const encoder = new TextEncoder();

  for (const filePath of files) {
    const relPath = relative(basePath, filePath);
    const data = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    entries.push({
      name: encoder.encode(relPath),
      data,
      crc: crc32(data),
    });
  }

  // Build ZIP file structure
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    // Local file header
    const header = new Uint8Array(30 + entry.name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); // signature
    hv.setUint16(4, 20, true); // version needed
    hv.setUint16(6, 0, true); // flags
    hv.setUint16(8, 0, true); // compression: store
    hv.setUint16(10, 0, true); // mod time
    hv.setUint16(12, 0, true); // mod date
    hv.setUint32(14, entry.crc, true); // crc32
    hv.setUint32(18, entry.data.length, true); // compressed size
    hv.setUint32(22, entry.data.length, true); // uncompressed size
    hv.setUint16(26, entry.name.length, true); // name length
    hv.setUint16(28, 0, true); // extra length
    header.set(entry.name, 30);

    parts.push(header, entry.data);

    // Central directory entry
    const cd = new Uint8Array(46 + entry.name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // compression: store
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    cv.setUint32(16, entry.crc, true); // crc32
    cv.setUint32(20, entry.data.length, true); // compressed size
    cv.setUint32(24, entry.data.length, true); // uncompressed size
    cv.setUint16(28, entry.name.length, true); // name length
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    cd.set(entry.name, 46);

    centralDir.push(cd);
    offset += header.length + entry.data.length;
  }

  // End of central directory
  const cdOffset = offset;
  const cdParts = centralDir;
  let cdSize = 0;
  for (const p of cdParts) cdSize += p.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // signature
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // disk with CD
  ev.setUint16(8, entries.length, true); // entries on disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, cdSize, true); // CD size
  ev.setUint32(16, cdOffset, true); // CD offset
  ev.setUint16(20, 0, true); // comment length

  // Concatenate all parts
  const allParts = [...parts, ...cdParts, eocd];
  let totalSize = 0;
  for (const p of allParts) totalSize += p.length;

  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const p of allParts) {
    result.set(p, pos);
    pos += p.length;
  }

  return result;
}

/**
 * CRC32 implementation for ZIP file checksums.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
