import path from "path";
import fg from "fast-glob";
import tar from "tar-stream";
import fs from "fs";

// Function to create a tar stream for a specific byte
function createPack(outputPath: string): tar.Pack {
  const yourTarball = fs.createWriteStream(outputPath);
  const pack = tar.pack();
  pack.pipe(yourTarball);
  return pack;
}

// Function to add files to the tar stream
function addFileToPack(pack: tar.Pack, filePath: string) {
  return new Promise(async (resolve, reject) => {
    const entry = pack.entry(
      { name: filePath },
      await fs.promises.readFile(filePath),
      function (err) {
        if (err) {
          reject(err);
        }
        resolve(0);
      }
    );
    entry.end();
  });
}

async function addFileToPackStream(
  tarStreams: Record<string, tar.Pack>,
  match: "full_match" | "partial_match",
  chain: string,
  byte: string,
  filePath: string
) {
  const archiveName = `${match}.${chain}.${byte}.tar.gz`;

  if (!tarStreams[archiveName]) {
    tarStreams[archiveName] = createPack(`./exports/${archiveName}`);
  }

  // Add files dynamically
  await addFileToPack(tarStreams[archiveName], filePath);
}

export function processChain(chainId: string) {
  const tarStreams: Record<string, tar.Pack> = {};

  return new Promise(async (resolve) => {
    const baseDir = path.resolve("./repository");
    const READ_CONCURRENCY = 50;

    try {
      // Create a glob pattern that matches both 'full_match' and 'partial_match'
      const pattern = `{full_match,partial_match}/${chainId}/**/*`;

      // Create a stream of file entries using fast-glob
      const entries = fg.stream(pattern, {
        cwd: baseDir,
        onlyFiles: true,
        concurrency: READ_CONCURRENCY,
      });

      for await (const entry of entries) {
        // Get the relative path from the entry
        const relativePath = entry as string;
        const filePath = path.join("./repository", relativePath);

        // Extract matchType and other necessary information from the relative path
        const pathParts = relativePath.split("/");
        const matchType = pathParts[0]; // 'full_match' or 'partial_match'
        const addressDirName = pathParts[2]; // Assuming path format: 'matchType/chainId/addressDirName/...'

        const addressName = addressDirName;
        const firstTwoChars = addressName.startsWith("0x")
          ? addressName.slice(2, 4)
          : addressName.slice(0, 2);
        const firstByte = firstTwoChars.toLowerCase();

        // Call your processing function
        if (matchType === "full_match" || matchType === "partial_match") {
          await addFileToPackStream(
            tarStreams,
            matchType,
            chainId,
            firstByte,
            filePath
          );
        }
      }

      let closedStreams = 0;
      for (const archiveName of Object.keys(tarStreams)) {
        tarStreams[archiveName].on("close", function () {
          closedStreams++;
          if (Object.keys(tarStreams).length === closedStreams) {
            resolve(0);
          }
        });
        tarStreams[archiveName].finalize();
      }
    } catch (error) {
      console.error(`Error processing chain ${chainId}:`, error);
    }
  });
}
