import path from "path";
import { fileURLToPath } from "url";
import { globby } from "globby";
import { execa } from "execa";
import sharp from "sharp";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const itemsFolder = path.join(__dirname, "Item");
// const outputFolder = path.join(__dirname, "Output_Icons");
const outputFolder = process.cwd();
const logFilePath = path.join(outputFolder, "convert_log.txt");

async function logToFile(message) {
  await fs.appendFile(logFilePath, message + "\n");
}

async function convertDDSFiles() {
  const ddsFiles = await globby(["**/*.dds", "**/*.DDS"], { cwd: itemsFolder });

  if (ddsFiles.length === 0) {
    console.log("No .dds or .DDS files found in Item folder.");
    return;
  }

  await fs.mkdir(outputFolder, { recursive: true });
  await fs.writeFile(logFilePath, "Conversion Log\n===============\n\n");

  let successCount = 0;
  const failedFiles = [];

  for (const file of ddsFiles) {
    const inputPath = path.join(itemsFolder, file);
    const baseName = path.basename(file, path.extname(file)).toLowerCase();
    const tempPngPath = path.join(outputFolder, `${baseName}_temp.png`);
    const outputJpgPath = path.join(outputFolder, `${baseName}.jpg`);

    try {
      await logToFile(`Converting ${file}...`);

      // Convert DDS to PNG first with ImageMagick
      await execa("convert", [inputPath, tempPngPath]);

      // Read the PNG file into sharp
      const imageBuffer = await fs.readFile(tempPngPath);
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();

      const newWidth = metadata.width * 2;
      const newHeight = metadata.height * 2;

      // Resize and get raw pixel data
      const { data, info } = await image
        .resize(newWidth, newHeight, { kernel: sharp.kernel.lanczos3 })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixelCount = info.width * info.height;
      const channels = info.channels;

      // Replace magenta-ish pixels with white
      for (let i = 0; i < pixelCount; i++) {
        const r = data[i * channels];
        const g = data[i * channels + 1];
        const b = data[i * channels + 2];

        if (r > 200 && g < 50 && b > 200) {
          data[i * channels] = 255;
          data[i * channels + 1] = 255;
          data[i * channels + 2] = 255;
          if (channels === 4) data[i * channels + 3] = 255;
        }
      }

      // Create new sharp instance from modified raw data
      // Flatten on white background to handle transparency for JPG
      await sharp(data, {
        raw: {
          width: info.width,
          height: info.height,
          channels: info.channels,
        },
      })
        .flatten({ background: { r: 255, g: 255, b: 255 } }) // fill transparent pixels with white
        .jpeg({ quality: 90 })
        .toFile(outputJpgPath);

      // Remove temp PNG
      await fs.unlink(tempPngPath);

      await logToFile(`✔ Success: ${outputJpgPath}`);
      successCount++;
    } catch (error) {
      const failMsg = `✘ Failed: ${file} - ${error.message}`;
      await logToFile(failMsg);
      failedFiles.push(file);
    }
  }

  console.log(`\nConversion Summary:`);
  console.log(`- Successful: ${successCount}`);
  console.log(`- Failed: ${failedFiles.length}`);
  if (failedFiles.length > 0) {
    console.log(`Failed Files:\n${failedFiles.join("\n")}`);
  }

  await logToFile(
    `\nSummary:\nSuccessful: ${successCount}\nFailed: ${failedFiles.length}`
  );
  if (failedFiles.length > 0) {
    await logToFile(`Failed Files:\n${failedFiles.join("\n")}`);
  }
}

convertDDSFiles();
