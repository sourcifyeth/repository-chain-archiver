# Repository Chain Archiver

## Description

Repository Chain Archiver is a tool designed to efficiently archive the Sourcify repository. It also uploads the archives to an S3-compatible object storage.

```ts
const s3Config = {
  bucketName: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT,
};

const repositoryChainsArchiver = new RepositoryChainsArchiver(
  ["1"], // chainIds
  "./repository", // repositoryPath
  "./exports", // exportPath
  s3Config
);
await repositoryChainsArchiver.processAndUpload();
// exports
// ├── full_match.1.2F.tar.gz
// ├── partial_match.1.1D.tar.gz
// └── partial_match.1.3D.tar.gz
```

RepositoryChainArchiver will create a `tar.gz` file for each combination of `matchType`, `chain`, and `first_byte`.

E.g. `exports/full_match.1.2F.tar.gz` will contain all the full_match contracts for chain 1 starting with `0x2F`.

```
exports/repository
└── full_match
    └── 1
        ├── 0x2F15c2a2FC43feb0DD7A99B1A7B36E39c6f5eAEE
        │   └── files
        └── 0x2F95c2a2FC43feb0DD7A99B1A7B36E39c6f5eAEE
            └── files
```

Finally, the archives are uploaded to an S3-compatible object storage.

## How it works

RepositoryChainsArchiver processes the Sourcify repository using the following approach:

1. Multiple tar streams are opened, one for each combination of `matchType`, `chain`, and `first_byte`.
2. A stream of files is created using `fast-glob`, which reads the repository directory structure.
3. As each file is read from the stream, it's analyzed to determine the appropriate tar stream.
4. The file is then added to the corresponding tar stream based on its `matchType`, `chain`, and `first_byte`.
5. Once all files are processed, the tar streams are finalized, creating compressed `.tar.gz` archives.

This streaming approach enables efficient parallel processing of large repositories.

## Installation

```bash
npm install
```

## Usage

Set the environment variables in the `.env` file and run the script.

```bash
npm start
```

## Testing

```bash
npm test
```
