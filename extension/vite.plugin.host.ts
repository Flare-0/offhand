// Legacy ES3 host handlers live at `extension/host/**` during the rewrite and
// are copied next to the built panel so `src/jsx/aeft/aeft.ts` can `$.evalFile`
// them at runtime. `copyAssets` cannot do this: it resolves paths under
// `extension/src`, not the extension root.

import fs from "fs";
import path from "path";
import type { Plugin } from "vite";

export const copyLegacyHost = (hostDir: string, outDir: string): Plugin => ({
  name: "offhand-copy-legacy-host",
  apply: "build",
  writeBundle() {
    const from = path.resolve(hostDir);
    const to = path.resolve(outDir, "host");
    if (!fs.existsSync(from)) return;
    fs.cpSync(from, to, { recursive: true });
  },
});
