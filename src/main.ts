import RepositoryChainsArchiver from "./RepositoryChainsArchiver";
import dotenv from "dotenv";

dotenv.config();

if (
  !process.env.CHAINS ||
  !process.env.S3_BUCKET ||
  !process.env.S3_REGION ||
  !process.env.S3_ACCESS_KEY_ID ||
  !process.env.S3_SECRET_ACCESS_KEY ||
  !process.env.S3_ENDPOINT
) {
  console.error("Missing environment variables");
  process.exit(1);
}

const repositoryChainsArchiver = new RepositoryChainsArchiver(
  process.env.CHAINS.split(","),
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
