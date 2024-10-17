# Repository Chain Archiver

## Description

Repository Chain Archiver is a tool designed to efficiently archive the Sourcify repository. 

```ts
const repositoryChain1Archiver = new RepositoryChainArchiver(
"1", // chainId
"./repository", // repositoryPath
"./exports" // exportPath
);
await repositoryChain1Archiver.processChain();
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

## How it works

RepositoryChainArchiver processes the Sourcify repository using the following approach:

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


// TODO: Add usage instructions

## Testing

```bash
npm test
```
