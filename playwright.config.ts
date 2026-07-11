import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.PLAYWRIGHT_PORT || 8899);
const runtimeDir = path.resolve("runtime", `test-playwright-${process.pid}`);

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1402, height: 1122 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    permissions: ["microphone", "camera"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
    }
  },
  webServer: {
    command: `set PORT=${port}&& set JARVIS_RUNTIME_DIR=${runtimeDir}&& set JARVIS_MOCK_SCREEN_CAPTURE=1&& set JARVIS_DESKTOP_CONTROL_DRY_RUN=1&& npm run build && npm start`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
