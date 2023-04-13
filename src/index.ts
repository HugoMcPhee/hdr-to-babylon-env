#!/usr/bin/env node

import * as BABYLON from "babylonjs";
import puppeteer from "puppeteer";
// import chromePaths from "chrome-paths";
import fs from "fs/promises";
import path from "path";
import delay from "delay";

type HDRFileProbeData = { name: string; data: string };
type EnvFileData = { name: string; data: string | ArrayBuffer | null };

(async () => {
  // const nodeScriptPath = __dirname;
  const folderPath = process.cwd();

  const probeResolution = process.argv[2] ? parseInt(process.argv[2], 10) : 256;
  // probeResolution = parseInt(probeResolution, 10);

  // type HDRFileProbeData = { name: "probe.hdr" , data: base64String}
  const hdrFilesData = [] as HDRFileProbeData[];

  const HDRMimeType = "image/vnd.radiance";
  const prefixForHDRDataUrl = `data:${HDRMimeType};base64,`;

  // checks a file or folder and saves the HDR data if it's a HDR file
  async function checkDirectoryItem(fileName: string) {
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
    headless: true,
    // executablePath: chromePaths.chrome,
    // args: [`--window-size=100,100`],
  };

  // const browser = await puppeteer.launch(launchOptions);
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.addScriptTag({ url: "https://cdn.babylonjs.com/babylon.js" });

  console.log("found");
  console.log(hdrFilesData.map((item) => item.name));
  console.log(`converting to env files with a size of ${probeResolution}`);

  // function logSomethingToConsole(thing: string | any) {
  //   console.log(`logging something to console`);
  //   console.log(thing);
  // }

  const envFilesData = await page.evaluate(
    async (hdrFilesData, probeResolution) => {
      // type EnvFileData = { name: "probe.hdr" , data: binaryString}
      const envFilesData = [] as EnvFileData[];

      // ----------------------------------
      // Setting up a babylonjs scene
      // ----------------------------------
      var canvas = document.createElement("canvas");
      canvas.id = "renderCanvas";
      document.body.appendChild(canvas);

      // logSomethingToConsole("hello");

      var engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        premultipliedAlpha: false,
      });
      var scene = new BABYLON.Scene(engine);
      // logSomethingToConsole(scene);
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
            resolve(null);
          });
        });
      }
      async function getBlobAsBinaryString(
        theBlob: Blob
      ): Promise<string | ArrayBuffer | null> {
        return new Promise(async (resolve, reject) => {
          const reader = new FileReader();
          reader.readAsBinaryString(theBlob);
          reader.onload = () => resolve(reader.result);
          reader.onerror = () =>
            reject("Error occurred while reading binary string");
        });
      }
      async function getEnvFileBinaryStringFromHdrString(hdrString: string) {
        const environment = new BABYLON.HDRCubeTexture(
          hdrString,
          scene,
          probeResolution,
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

      async function getEnvFileDataFromHdrFileData(
        hdrDataItem: HDRFileProbeData
      ) {
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

  async function writeEnvFileDataToFile(envDataItem: EnvFileData) {
    const envFilePath = path.join(folderPath, envDataItem.name);
    const envData = envDataItem.data;
    if (typeof envData === "string") {
      const nodeFile = Buffer.from(envData, "binary");
      await fs.writeFile(envFilePath, nodeFile, "binary");
    }
  }

  await Promise.all(
    envFilesData.map((envFileData) => writeEnvFileDataToFile(envFileData))
  );

  // close the browser
  await browser.close();
})();
