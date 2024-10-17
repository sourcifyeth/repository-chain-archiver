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

export default class RepositoryChainArchiver {
  private tarStreams: Record<string, tar.Pack> = {};

  constructor(
    private chainId: string,
    private repositoryPath: string,
    private exportPath: string
  ) {}

  // Function to add files to the tar stream
  addFileToPack(pack: tar.Pack, filePath: string) {
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

  async addFileToPackStream(
    match: "full_match" | "partial_match",
    chain: string,
    byte: string,
    filePath: string
  ) {
    const archiveName = `${match}.${chain}.${byte}.tar.gz`;
    if (!this.tarStreams[archiveName]) {
      this.tarStreams[archiveName] = createPack(
        path.join(this.exportPath, archiveName)
      );
    }

    await this.addFileToPack(this.tarStreams[archiveName], filePath);
  }

  processChain() {
    return new Promise(async (resolve) => {
      const baseDir = path.resolve(this.repositoryPath);
      const READ_CONCURRENCY = 50;

      try {
        // Create a glob pattern that matches both 'full_match' and 'partial_match'
        const pattern = `{full_match,partial_match}/${this.chainId}/**/*`;

        // Create a stream of file entries using fast-glob
        const entries = fg.stream(pattern, {
          cwd: baseDir,
          onlyFiles: true,
          concurrency: READ_CONCURRENCY,
        });

        for await (const entry of entries) {
          // Get the relative path from the entry
          const relativePath = entry as string;
          const filePath = path.join(this.repositoryPath, relativePath);

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
            await this.addFileToPackStream(
              matchType,
              this.chainId,
              firstByte,
              filePath
            );
          }
        }

        let closedStreams = 0;
        for (const archiveName of Object.keys(this.tarStreams)) {
          this.tarStreams[archiveName].on("close", () => {
            closedStreams++;
            if (Object.keys(this.tarStreams).length === closedStreams) {
              resolve(0);
            }
          });
          this.tarStreams[archiveName].finalize();
        }
      } catch (error) {
        console.error(`Error processing chain ${this.chainId}:`, error);
      }
    });
  }
}
