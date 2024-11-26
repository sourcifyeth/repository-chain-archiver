import path from "path";
import fg from "fast-glob";
import tar from "tar-stream";
import fs from "fs";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

interface S3Config {
  bucketName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

// Function to create a tar stream for a specific byte
function createPack(outputPath: string): tar.Pack {
  const yourTarball = fs.createWriteStream(outputPath);
  const pack = tar.pack();
  pack.pipe(yourTarball);
  return pack;
}

export default class RepositoryChainsArchiver {
  private tarStreams: Record<string, tar.Pack> = {};

  constructor(
    private chainIds: string[],
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

  async processChains() {
    await fs.promises.mkdir(this.exportPath, { recursive: true });
    const baseDir = path.resolve(this.repositoryPath);
    const READ_CONCURRENCY = 50;

    try {
      // Create a glob pattern that matches both 'full_match' and 'partial_match'
      const pattern = `{full_match,partial_match}/{${this.chainIds.join(
        ","
      )}}/**/*`;

      // Create a stream of file entries using fast-glob
      const entries = fg.stream(pattern, {
        cwd: baseDir,
        onlyFiles: true,
        concurrency: READ_CONCURRENCY,
      });

      // For each entry, add the file to the appropriate tar stream
      for await (const entry of entries) {
        const relativePath = entry.toString();
        const filePath = path.join(this.repositoryPath, relativePath);

        // Extract matchType and other necessary information from the relative path
        const pathParts = relativePath.split("/");
        const matchType = pathParts[0]; // 'full_match' or 'partial_match'
        const chainId = pathParts[1]; // 'full_match' or 'partial_match'
        const address = pathParts[2]; // Assuming path format: 'matchType/chainId/addressDirName/...'

        if (!address.startsWith("0x")) {
          console.log("Skipping non-address folder:", filePath);
          continue;
        }

        if (matchType !== "full_match" && matchType !== "partial_match") {
          console.log("Skipping non-match folder:", filePath);
          continue;
        }

        const firstTwoChars = address.slice(2, 4);
        const firstByte = firstTwoChars.toUpperCase();

        // Add the file to the appropriate tar stream
        await this.addFileToPackStream(matchType, chainId, firstByte, filePath);
      }

      // After all files have been added, finalize the tar streams
      for (const archiveName of Object.keys(this.tarStreams)) {
        this.tarStreams[archiveName].finalize();
      }
    } catch (error) {
      console.error(
        `Error processing chains ${this.chainIds.join(",")}:`,
        error
      );
    }
  }

  private async uploadFile(
    s3Client: S3Client,
    bucketName: string,
    localPath: string,
    s3Key: string
  ): Promise<void> {
    const fileContent = await fs.promises.readFile(localPath);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fileContent,
      })
    );
    console.log(`Uploaded ${s3Key} to ${bucketName}`);
  }

  private async deleteOldBackups(
    s3Client: S3Client,
    bucketName: string
  ): Promise<void> {
    // List only the root folders with the prefix
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: "sourcify-repository-",
        Delimiter: "/", // This will only list the root folders
      })
    );

    if (
      !listResponse.CommonPrefixes ||
      listResponse.CommonPrefixes.length <= 3
    ) {
      return;
    }

    // Sort folders by their timestamp and keep only the ones to delete
    const foldersToDelete = listResponse.CommonPrefixes.map(
      (prefix) => prefix.Prefix || ""
    )
      .sort((a, b) => b.localeCompare(a)) // Sort in descending order
      .slice(3); // Keep only the 3 most recent backups

    // Delete each old folder recursively
    for (const folder of foldersToDelete) {
      await this.deleteFolderContents(s3Client, bucketName, folder);
    }
  }

  private async deleteFolderContents(
    s3Client: S3Client,
    bucket: string,
    prefix: string
  ): Promise<void> {
    let continuationToken: string | undefined;

    do {
      // List objects in the folder (paginated)
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const listResponse = await s3Client.send(listCommand);

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        // Delete objects in batches
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key })),
              Quiet: false,
            },
          })
        );
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);
  }

  async uploadS3(s3Config: S3Config): Promise<void> {
    const s3Client = new S3Client({
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      endpoint: s3Config.endpoint,
    });
    try {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:]/g, "-")
        .split(".")[0];
      const backupName = `sourcify-repository-${timestamp}`;

      // Generate manifest
      const manifest = {
        description:
          "Manifest file for when the Sourcify file repository was uploaded",
        timestamp: Date.now(),
        dateStr: new Date().toISOString(),
        files: Object.keys(this.tarStreams).map((archiveName) => ({
          path: `${backupName}/${archiveName}`,
          sizeInBytes: fs.statSync(path.join(this.exportPath, archiveName))
            .size,
        })),
      };

      // Write manifest locally
      const manifestPath = path.join(this.exportPath, "manifest.json");
      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2)
      );

      // Upload all tar files
      for (const archiveName of Object.keys(this.tarStreams)) {
        const localPath = path.join(this.exportPath, archiveName);
        const s3Key = `${backupName}/${archiveName}`;
        await this.uploadFile(s3Client, s3Config.bucketName, localPath, s3Key);
      }

      // Upload manifest files
      await this.uploadFile(
        s3Client,
        s3Config.bucketName,
        manifestPath,
        `${backupName}/manifest.json`
      );
      await this.uploadFile(
        s3Client,
        s3Config.bucketName,
        manifestPath,
        "manifest.json"
      );

      // Clean up old backups
      await this.deleteOldBackups(s3Client, s3Config.bucketName);

      // Clean up local files
      const files = await fs.promises.readdir(this.exportPath);
      await Promise.all(
        files.map((file) =>
          fs.promises.rm(path.join(this.exportPath, file), {
            recursive: true,
            force: true,
          })
        )
      );
      console.log("Upload completed successfully");
    } catch (error) {
      console.error("Error during upload:", error);
      throw error;
    }
  }
}
