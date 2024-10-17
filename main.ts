import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";

// Function to create a tar stream for a specific combination
function createTarStream(outputPath: string): ReturnType<typeof spawn> {
  const tarProcess = spawn("tar", ["czf", outputPath, "-T", "-"], {
    stdio: ["pipe", "inherit", "inherit"],
  });

  // Handle errors in the tar process
  tarProcess.on("error", (err) => {
    console.error(`Failed to start tar process: ${err.message}`);
  });

  tarProcess.on("close", (code) => {
    if (code !== 0) {
      console.error(`tar process exited with code ${code}`);
    }
  });

  return tarProcess;
}

// Function to add files to the tar stream
function addFileToTar(tarProcess: ReturnType<typeof spawn>, filePath: string) {
  // Write the file path to tar's stdin (which reads file names from the input)
  tarProcess!.stdin!.write(`${filePath}\n`);
}

const tarStreams = {};

function addFileToTarStream(
  match: "full_match" | "partial_match",
  chain: string,
  byte: string,
  filePath: string
) {
  const archiveName = `${match}.${chain}.${byte}.tar.gz`;

  if (!tarStreams[archiveName]) {
    tarStreams[archiveName] = createTarStream(`./exports/${archiveName}`);
  }

  // Add files dynamically
  addFileToTar(tarStreams[archiveName], filePath);
}

async function processChain(chainId: string) {
  const baseDir = path.resolve("./repository");

  try {
    const matchTypes = ["full_match", "partial_match"];
    const processFile = async (matchType, addressDir, file) => {
      const matchTypeDir = path.join(baseDir, matchType, chainId);
      const addressPath = path.join(matchTypeDir, addressDir.name);
      const fullPath = path.join(addressPath, file);

      const addressName = addressDir.name;
      const firstTwoChars = addressName.startsWith("0x")
        ? addressName.slice(2, 4)
        : addressName.slice(0, 2);
      const firstByte = firstTwoChars.toLowerCase();

      addFileToTarStream(matchType, chainId, firstByte, fullPath);
    };

    await Promise.all(
      matchTypes.map(async (matchType) => {
        const matchTypeDir = path.join(baseDir, matchType, chainId);
        const addressDirs = await fs.readdir(matchTypeDir, {
          withFileTypes: true,
        });

        await Promise.all(
          addressDirs.map(async (addressDir) => {
            if (addressDir.isDirectory()) {
              const addressPath = path.join(matchTypeDir, addressDir.name);
              const files = await fs.readdir(addressPath);

              await Promise.all(
                files.map((file) => processFile(matchType, addressDir, file))
              );
            }
          })
        );
      })
    );
    // When done, close the tar stream
    for (const archiveName of Object.keys(tarStreams)) {
      tarStreams[archiveName].stdin!.end();
    }
  } catch (error) {
    console.error(`Error processing chain ${chainId}:`, error);
  }
}

processChain("1");
