import RepositoryChainsArchiver from "./RepositoryChainsArchiver";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

if (
  !process.env.S3_BUCKET ||
  !process.env.S3_REGION ||
  !process.env.S3_ACCESS_KEY_ID ||
  !process.env.S3_SECRET_ACCESS_KEY ||
  !process.env.S3_ENDPOINT
) {
  console.error("Missing environment variables");
  process.exit(1);
}

let chainsToArchive: string[] = [];

// if CHAINS is not provided, read all chains from the repository
if (!process.env.CHAINS) {
  const chains: string[] = [];

  for (const subDir of ["full_match", "partial_match"]) {
    const dirPath = `./repository/${subDir}`;
    if (fs.existsSync(dirPath)) {
      const chainDirs = await fs.promises.readdir(dirPath);
      chainDirs.forEach((chain) => chains.push(chain));
    }
  }
  // Remove duplicates
  chainsToArchive = [...new Set(chains)];
} else {
  chainsToArchive = process.env.CHAINS.split(",");
}

const repositoryChainsArchiver = new RepositoryChainsArchiver(
  chainsToArchive,
  "./repository",
  "./exports"
);
await repositoryChainsArchiver.processChains();

await repositoryChainsArchiver.uploadS3({
  bucketName: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT,
});
