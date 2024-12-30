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

interface UploadedFile {
  path: string;
  sizeInBytes: number;
}

// Function to create a tar stream for a specific byte
function createPack(outputPath: string): tar.Pack {
  const yourTarball = fs.createWriteStream(outputPath);
  const pack = tar.pack();
  pack.pipe(yourTarball);
  return pack;
}

export default class RepositoryChainsArchiver {
  private s3Client: S3Client;
  private s3BucketName: string;

  constructor(
    private chainIds: string[],
    private repositoryPath: string,
    private exportPath: string,
    s3Config: S3Config
  ) {
    this.s3Client = new S3Client({
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      endpoint: s3Config.endpoint,
    });
    this.s3BucketName = s3Config.bucketName;
  }

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

  async processAndUpload() {
    await fs.promises.mkdir(this.exportPath, { recursive: true });
    const baseDir = path.resolve(this.repositoryPath);
    const READ_CONCURRENCY = 50;

    const timestamp = new Date();
    const timestampString = timestamp
      .toISOString()
      .replace(/[:]/g, "-")
      .split(".")[0];
    const backupName = `sourcify-repository-${timestampString}`;

    try {
      const uploadedFiles: UploadedFile[] = [];
      let processedContracts = 0;
      const startTime = performance.now();
      for (const matchType of ["full_match", "partial_match"]) {
        for (const chainId of this.chainIds) {
          for (let i = 0; i < 256; i++) {
            const byte = i.toString(16).padStart(2, "0");
            console.log(`Processing ${matchType} ${chainId} ${byte}`);
            const pattern = `${matchType}/${chainId}/0x${byte}*/**/*`;
            const entries = fg.stream(pattern, {
              cwd: baseDir,
              onlyFiles: true,
              concurrency: READ_CONCURRENCY,
              caseSensitiveMatch: false,
            });

            // Create tar stream for current byte
            const archiveName = `${matchType}.${chainId}.${byte}.tar.gz`;
            const localPath = path.join(this.exportPath, archiveName);
            let currentTarStream: tar.Pack | undefined;

            const byteStartTime = performance.now();
            let byteProcessedContracts = 0;
            for await (const entry of entries) {
              if (!currentTarStream) {
                currentTarStream = createPack(localPath);
              }

              const relativePath = entry.toString();
              const filePath = path.join(this.repositoryPath, relativePath);

              const pathParts = relativePath.split("/");
              const address = pathParts[2]; // Assuming path format: 'matchType/chainId/addressDirName/...'

              if (!address.startsWith("0x")) {
                console.log("Skipping non-address folder:", filePath);
                continue;
              }

              await this.addFileToPack(currentTarStream, filePath);
              byteProcessedContracts++;
              processedContracts++;
            }
            const durationInSeconds =
              (performance.now() - byteStartTime) / 1000;
            console.log(
              `Processed ${matchType} ${chainId} ${byte} in ${durationInSeconds.toFixed(
                4
              )}s with a rate of ${(
                byteProcessedContracts / durationInSeconds
              ).toFixed(2)} contracts/s`
            );
            console.log(
              `Total processing rate at ${(
                processedContracts /
                ((performance.now() - startTime) / 1000)
              ).toFixed(2)} contracts/s`
            );

            if (currentTarStream) {
              currentTarStream.finalize();
              const s3Key = `${backupName}/${archiveName}`;
              // Don't await this in order to process the next byte concurrently
              this.uploadAndDeleteFile(localPath, s3Key, uploadedFiles);
            }
          }
        }
      }
      await this.uploadManifest(backupName, uploadedFiles);
      await this.deleteOldBackups();
      console.log("Deleted old backups");
    } catch (error) {
      console.error(
        `Error processing chains ${this.chainIds.join(",")}:`,
        error
      );
    }
    console.log("Done");
  }

  private async uploadAndDeleteFile(
    localPath: string,
    s3Key: string,
    uploadedFiles: UploadedFile[]
  ): Promise<void> {
    await this.uploadFile(localPath, s3Key);
    const fileStats = await fs.promises.stat(localPath);
    uploadedFiles.push({
      path: `/${s3Key}`,
      sizeInBytes: fileStats.size,
    });

    await fs.promises.rm(localPath, {
      recursive: true,
      force: true,
    });
    console.log(`Deleted local file: ${localPath}`);
  }

  private async uploadFile(localPath: string, s3Key: string): Promise<void> {
    const startTime = performance.now();
    const fileContent = await fs.promises.readFile(localPath);
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.s3BucketName,
        Key: s3Key,
        Body: fileContent,
      })
    );

    const durationInSeconds = (performance.now() - startTime) / 1000;
    console.log(
      `Uploaded ${s3Key} to ${this.s3BucketName} in ${durationInSeconds.toFixed(
        4
      )}s`
    );
  }

  private async deleteOldBackups(): Promise<void> {
    // List only the root folders with the prefix
    const listResponse = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.s3BucketName,
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
      await this.deleteFolderContents(folder);
    }
  }

  private async deleteFolderContents(prefix: string): Promise<void> {
    let continuationToken: string | undefined;

    do {
      // List objects in the folder (paginated)
      const listCommand = new ListObjectsV2Command({
        Bucket: this.s3BucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const listResponse = await this.s3Client.send(listCommand);

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        // Delete objects in batches
        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: this.s3BucketName,
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

  async uploadManifest(
    backupName: string,
    uploadedFiles: { path: string; sizeInBytes: number }[]
  ): Promise<void> {
    // Generate manifest
    const manifest = {
      description:
        "Manifest file for when the Sourcify file repository was uploaded",
      timestamp: Date.now(),
      dateStr: new Date().toISOString(),
      files: uploadedFiles,
    };

    // Write manifest locally
    const manifestPath = path.join(this.exportPath, "manifest.json");
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2)
    );

    // Upload manifest files
    await this.uploadFile(manifestPath, `${backupName}/manifest.json`);
    await this.uploadFile(manifestPath, "manifest.json");

    // Delete local manifest file
    await fs.promises.rm(manifestPath, {
      force: true,
    });
  }
}
