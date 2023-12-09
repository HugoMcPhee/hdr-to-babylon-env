#!/usr/bin/env node

const puppeteer = require("puppeteer-core");
const chromePaths = require("chrome-paths");
const fs = require("fs").promises;
var path = require("path");

(async () => {
  // const nodeScriptPath = __dirname;
  const folderPath = process.cwd();

  let probeResolution = process.argv[2] || 256;
  probeResolution = parseInt(probeResolution, 10);

  // type HDRFileProbeData = { name: "probe.hdr" , data: base64String}
  const hdrFilesData = []; // as HDRFileProbeData[]

  const HDRMimeType = "image/vnd.radiance";
  const prefixForHDRDataUrl = `data:${HDRMimeType};base64,`;

  // checks a file or folder and saves the HDR data if it's a HDR file
  async function checkDirectoryItem(fileName) {
    const filePath = path.join(folderPath, fileName);

    const isHDRFile = filePath.toLowerCase().includes(".hdr");
    if (isHDRFile) {
      const fileDataUrl = await fs.readFile(filePath, {
        encoding: "base64",
      });
      const dataUrlWithMimeType = prefixForHDRDataUrl + fileDataUrl;
      hdrFilesData.push({ name: fileName, data: dataUrlWithMimeType });
    }
  }

  const files = await fs.readdir(folderPath);
  await Promise.all(files.map((fileName) => checkDirectoryItem(fileName)));

  let launchOptions = {
    headless: false,
    executablePath: chromePaths.chrome,
    args: [`--window-size=100,100`],
  };

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.addScriptTag({ url: "https://cdn.babylonjs.com/babylon.js" });

  console.log("found");
  console.log(hdrFilesData.map((item) => item.name));
  console.log(`converting to env files with a size of ${probeResolution}`);

  const envFilesData = await page.evaluate(
    async (hdrFilesData, probeResolution) => {
      // type EnvFileData = { name: "probe.hdr" , data: binaryString}
      const envFilesData = []; // as EnvFileData[]

      // ----------------------------------
      // Setting up a babylonjs scene
      // ----------------------------------
      var canvas = document.createElement("canvas");
      canvas.id = "renderCanvas";
      document.body.appendChild(canvas);

      var engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        premultipliedAlpha: false,
      });
      var scene = new BABYLON.Scene(engine);
      var camera = new BABYLON.FreeCamera(
        "camera1",
        new BABYLON.Vector3(0, 5, -10),
        scene
      );
      camera.setTarget(BABYLON.Vector3.Zero());
      camera.attachControl(canvas, true);

      // ----------------------------------
      // Converting HDR to Env
      // ----------------------------------

      async function waitForSceneReady() {
        return new Promise(async (resolve, reject) => {
          scene.executeWhenReady(() => {
            resolve();
          });
        });
      }
      async function getBlobAsBinaryString(theBlob) {
        return new Promise(async (resolve, reject) => {
          const reader = new FileReader();
          reader.readAsBinaryString(theBlob);
          reader.onload = () => resolve(reader.result);
          reader.onerror = () =>
            reject("Error occurred while reading binary string");
        });
      }
      async function getEnvFileBinaryStringFromHdrString(hdrString) {
        const environment = new BABYLON.HDRCubeTexture(
          hdrString,
          scene,
          parseInt(probeResolution, 10),
          false,
          true,
          false,
          true
        );
        await waitForSceneReady();
        const arrayBuffer =
          await BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync(
            environment
          );
        var blob = new Blob([arrayBuffer], { type: "octet/stream" });
        const binaryFileResult = await getBlobAsBinaryString(blob);
        environment.dispose();
        return binaryFileResult;
      }

      async function getEnvFileDataFromHdrFileData(hdrDataItem) {
        const newData = await getEnvFileBinaryStringFromHdrString(
          hdrDataItem.data
        );
        return {
          data: newData,
          name: hdrDataItem.name.replace(".hdr", ".env"),
        };
      }

      await waitForSceneReady();

      for (const hdrFileData of hdrFilesData) {
        const envFileData = await getEnvFileDataFromHdrFileData(hdrFileData);
        envFilesData.push(envFileData);
      }

      return envFilesData;
    },
    hdrFilesData,
    probeResolution
  );

  async function writeEnvFileDataToFile(envDataItem) {
    const envFilePath = path.join(folderPath, envDataItem.name);
    const nodeFile = Buffer.from(envDataItem.data, "binary");
    await fs.writeFile(envFilePath, nodeFile, "binary");
  }

  await Promise.all(
    envFilesData.map((envFileData) => writeEnvFileDataToFile(envFileData))
  );

  // close the browser
  await browser.close();
})();
