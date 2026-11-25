// The single ExtendScript entry point the panel calls via `evalTS()`.
//
// Until Phase D ports the host to typed modules, this delegates to the legacy
// ES3 bundle that vite copies to `dist/cep/host/offhand.jsx`. Path resolution:
// this file becomes `dist/cep/jsx/index.js`, so `parent.parent` is `dist/cep`.

export const dispatch = (tool: string, argsJson: string): string => {
  try {
    const self = new File($.fileName);
    const root = self.parent.parent.fsName;
    const hostFile = new File(root + "/host/offhand.jsx");

    if (!hostFile.exists) {
      return JSON.stringify({
        ok: false,
        error: {
          code: "HOST_UNAVAILABLE",
          message: "The offhand host scripts are missing from the extension.",
          hint: "Rebuild the extension with `npm run build:extension`.",
        },
      });
    }

    // @ts-ignore - global installed by extension/host/offhand.jsx
    if (typeof Offhand === "undefined" || !Offhand.loaded) {
      $.evalFile(hostFile);
    }

    // @ts-ignore
    return Offhand.dispatch(tool, argsJson);
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: {
        code: "HOST_ERROR",
        message:
          error && error.message ? String(error.message) : String(error),
        hint: "Reload the offhand panel, then retry.",
      },
    });
  }
};
