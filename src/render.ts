import { launch } from "@cloudflare/playwright";
import { SnapError } from "./errors";
import type { ConsumerPolicy, NormalizedCapture } from "./types";
import { fitHtml } from "./fit";

export async function renderCapture(
  binding: Env["BROWSER"],
  input: NormalizedCapture,
  policy: ConsumerPolicy,
) {
  const browser = await launch(binding);
  const deadline = Date.now() + 60_000;
  const remaining = () => Math.max(1, deadline - Date.now());
  try {
    const context = await browser.newContext({
      viewport: input.resolution,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const document = request.isNavigationRequest();
      const allowed = document
        ? request.frame() === page.mainFrame() &&
          url.href === input.url &&
          !request.redirectedFrom()
        : url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          policy.resourceOrigins.includes(url.origin);
      await (allowed ? route.continue() : route.abort());
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const response = await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: remaining(),
    });
    if (!response?.ok()) throw new Error("Navigation failed");
    await page.waitForFunction(
      ({ ready, error }) => {
        const visible = (selector: string) => {
          const element = document.querySelector(selector);
          return (
            !!element &&
            element.getBoundingClientRect().width > 0 &&
            element.getBoundingClientRect().height > 0 &&
            getComputedStyle(element).visibility !== "hidden"
          );
        };
        if (error && visible(error)) throw new Error("Preview reported an error");
        return visible(ready);
      },
      { ready: input.readySelector, error: input.errorSelector },
      { timeout: remaining() },
    );
    const target = input.selector ? page.locator(input.selector) : null;
    const box = target ? await target.boundingBox({ timeout: remaining() }) : input.resolution;
    if (!box || box.width < 1 || box.height < 1 || box.width > 3840 || box.height > 2160)
      throw new Error("Invalid capture element size");
    const png = target
      ? await target.screenshot({ type: "png", animations: "disabled", timeout: remaining() })
      : await page.screenshot({ type: "png", animations: "disabled", timeout: remaining() });
    const output = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await output.setContent(
      fitHtml(`data:image/png;base64,${png.toString("base64")}`, input.background),
      { timeout: remaining() },
    );
    await output.locator("img").evaluate(
      async (img: HTMLImageElement) => {
        await img.decode();
      },
      undefined,
      { timeout: remaining() },
    );
    return {
      bytes: await output.screenshot({ type: "jpeg", quality: 90, timeout: remaining() }),
      source: { width: Math.round(box.width), height: Math.round(box.height) },
    };
  } catch {
    throw new SnapError(
      502,
      "capture_failed",
      "Preview navigation, readiness, or rendering failed",
    );
  } finally {
    await browser.close();
  }
}
