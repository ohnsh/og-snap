import { bindings, defineConfig } from "cf/config";
import consumers from "./consumers.json" with { type: "json" };

export default defineConfig(({ isPreview }) => ({
  worker: {
    name: "og-snap",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-11-05",
    compatibilityFlags: ["nodejs_compat"],
    domains: isPreview ? undefined : ["og.ohn.sh"],
    workersDev: false,
    previewUrls: true,
    env: {
      BROWSER: bindings.browser(),
      SNAPSHOTS: bindings.r2({ name: "og-snap" }),
      PUBLIC_ORIGIN: bindings.text("https://og.ohn.sh"),
      CONSUMERS: bindings.json(consumers),
      CONSUMER_TOKENS: bindings.secret(),
    },
    observability: {
      enabled: true,
      redactQueryString: true,
      traces: { enabled: true, headSamplingRate: 0.01 },
    },
  },
}));
