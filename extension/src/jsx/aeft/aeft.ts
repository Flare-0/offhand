// The single ExtendScript entry point the panel calls via `evalTS()`.
//
// Phase D moved the handlers into `src/jsx` (bundled into `jsx/index.js`), so
// this normally runs entirely in-process. The legacy ES3 host is kept as a
// safety net: if a tool somehow did not register, we fall back to
// `dist/cep/host/offhand.jsx` instead of failing the call.

import { dispatch as dispatchHost } from "../host";
import { Offhand } from "../core/state";

const legacyDispatch = (tool: string, argsJson: string): string | null => {
  try {
    const self = new File($.fileName);
    const root = self.parent.parent.fsName;
    const hostFile = new File(root + "/host/offhand.jsx");
    if (!hostFile.exists) return null;

    // @ts-ignore - global installed by extension/host/offhand.jsx
    if (typeof Offhand === "undefined" || !Offhand.loaded) {
      $.evalFile(hostFile);
    }
    // @ts-ignore
    return Offhand.dispatch(tool, argsJson);
  } catch (error) {
    return null;
  }
};

export const dispatch = (tool: string, argsJson: string): string => {
  try {
    // Only fall back when this build has no handler for the requested tool.
    // A handler that *returns* an UNKNOWN_TOOL error (batch does, for a bad
    // nested call) must not trigger the legacy tree.
    const registered =
      typeof Offhand !== "undefined" && Offhand.tools && Offhand.tools[tool];
    if (!registered) {
      const legacy = legacyDispatch(tool, argsJson);
      if (legacy !== null) return legacy;
    }
    return dispatchHost(tool, argsJson);
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
