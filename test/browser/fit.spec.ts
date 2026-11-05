import { expect, test } from "@playwright/test";
import { fitHtml } from "../../src/fit";

for (const [width, height, fittedWidth, fittedHeight] of [
  [1600, 600, 1200, 450],
  [800, 1200, 420, 630],
]) {
  test(`fits ${width}x${height} without cropping`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 630 });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="#ff0000" d="M0 0H${width}V${height}H0z"/></svg>`;
    await page.setContent(
      fitHtml(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, "#202020"),
    );
    await page.locator("img").evaluate(async (image: HTMLImageElement) => image.decode());
    const actual = await page.screenshot();
    const bounds = await page.evaluate(
      async (data) => {
        const image = new Image();
        image.src = data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 630;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, 1200, 630).data;
        let left = 1200,
          right = 0,
          top = 630,
          bottom = 0;
        for (let y = 0; y < 630; y++)
          for (let x = 0; x < 1200; x++) {
            const index = (y * 1200 + x) * 4;
            if (pixels[index] > 200 && pixels[index + 1] < 40) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        return { left, top, width: right - left + 1, height: bottom - top + 1 };
      },
      `data:image/png;base64,${actual.toString("base64")}`,
    );
    expect(Math.abs(bounds.width - fittedWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.height - fittedHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.left - (1200 - fittedWidth) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.top - (630 - fittedHeight) / 2)).toBeLessThanOrEqual(1);
  });
}
