# Repository Chain Archiver

## Description

Repository Chain Archiver is a tool designed to efficiently archive repositories. 

```ts
const repositoryChain1Archiver = new RepositoryChainArchiver(
"1", // chainId
"./repository", // repositoryPath
"./exports" // exportPath
);
await repositoryChain1Archiver.processChain();
```

RepositoryChainArchiver will create a `tar.gz` file for each combination of `matchType`, `chain`, and `first_byte`. 

E.g.
```
exports
├── full_match.1.2F.tar.gz
├── partial_match.1.1D.tar.gz
└── partial_match.1.3D.tar.gz
```

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
