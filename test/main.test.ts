import RepositoryChainArchiver from "../src/RepositoryChainArchiver";
import fs from "fs";
import path from "path";
import * as tar from "tar";
import assert from "assert";

// Helper function to get all file paths recursively
function getAllFilePaths(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFilePaths(filePath));
    } else {
      results.push(filePath.split("/").slice(-4).join("/"));
    }
  });
  return results;
}

let tempDir: string;

async function runTest() {
  // Run processChain for "1" and "5"
  const repositoryChain1Archiver = new RepositoryChainArchiver(
    "1",
    "./repository",
    "./exports"
  );
  await repositoryChain1Archiver.processChain();

  const repositoryChain5Archiver = new RepositoryChainArchiver(
    "5",
    "./repository",
    "./exports"
  );
  await repositoryChain5Archiver.processChain();

  const exportsDir = path.resolve("./exports");
  const repositoryDir = path.resolve("./repository");

  // Create a temporary directory for extraction

  tempDir = fs.mkdtempSync("./exports-repository");

  // Read all tar.gz files from exports
  const exportFiles = fs
    .readdirSync(exportsDir)
    .filter((file) => file.endsWith(".tar.gz"));

  // Extract all archives to the temporary directory
  for (const file of exportFiles) {
    const filePath = path.join(exportsDir, file);
    await tar.x({
      file: filePath,
      cwd: tempDir,
      strip: 1, // Remove the top-level directory from the archive
    });
  }

  // Get all file paths from repository
  const repositoryFiles = getAllFilePaths(repositoryDir).sort();
  const exportedFiles = getAllFilePaths(path.resolve(tempDir)).sort();

  // Compare the file lists
  assert.deepStrictEqual(
    exportedFiles,
    repositoryFiles,
    "Exported files do not match repository files"
  );

  console.log("All exported files match the repository files.");
}

runTest()
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    // Clean up the temporary directory
    await fs.promises.rm(path.resolve(tempDir), { recursive: true });
  });
