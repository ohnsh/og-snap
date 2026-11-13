import { expect, test } from "bun:test";
import { socialMeta, renderMetaTags } from "../../src/meta";

test("metadata supports missing images, explicit empty alt, and safe HTML serialization", () => {
  const input = { title: '"<script>&', description: "Archive", url: "https://days.ohn.sh/" };
  expect(socialMeta(input)).toContainEqual({ name: "twitter:card", content: "summary" });
  const tags = socialMeta({
    ...input,
    image: { url: "https://example.com/a.jpg", alt: "", width: 1200, height: 630 },
  });
  expect(tags).toContainEqual({ property: "og:image:alt", content: "" });
  expect(tags).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
  expect(renderMetaTags(tags)).toContain("&quot;&lt;script&gt;&amp;");
  expect(renderMetaTags(tags)).not.toContain("<script>");
});
