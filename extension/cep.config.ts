import type { CEP_Config } from "vite-cep-plugin";
import { version } from "./package.json";

const config: CEP_Config = {
  version,
  id: "com.offhand.panel",
  displayName: "offhand",
  symlink: "local",
  port: 3000,
  servePort: 5000,
  startingDebugPort: 8860,
  // Match the manifest version proven to work on After Effects 2023 (23.6).
  extensionManifestVersion: 7.0,
  requiredRuntimeVersion: 9.0,
  hosts: [{ name: "AEFT", version: "[23.0,99.9]" }],

  type: "Panel",
  iconDarkNormal: "./src/assets/light-icon.png",
  iconNormal: "./src/assets/dark-icon.png",
  iconDarkNormalRollOver: "./src/assets/light-icon.png",
  iconNormalRollOver: "./src/assets/dark-icon.png",
  // --enable-nodejs gives the panel a real Node runtime so it can host the
  // WebSocket server and read/write bridge.json with plain fs.
  parameters: ["--v=0", "--enable-nodejs", "--mixed-context"],
  width: 380,
  height: 480,

  panels: [
    {
      mainPath: "./main/index.html",
      name: "offhand",
      panelDisplayName: "offhand",
      autoVisible: true,
      width: 380,
      height: 480,
    },
  ],
  build: {
    jsxBin: "off",
    sourceMap: true,
  },
  zxp: {
    country: "US",
    province: "CA",
    org: "offhand",
    password: "offhand",
    tsa: [
      "http://timestamp.digicert.com/", // Windows Only
      "http://timestamp.apple.com/ts01", // MacOS Only
    ],
    allowSkipTSA: false,
    sourceMap: false,
    jsxBin: "off",
  },
  // `ws` is copied into dist so CEP's Node runtime can require() it — this is
  // what lets the panel own the WebSocket listener instead of dialing out.
  installModules: ["ws"],
  copyAssets: [],
  copyZipAssets: [],
};
export default config;
