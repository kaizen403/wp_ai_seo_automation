import "dotenv/config";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

async function main() {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("Missing FIRECRAWL_API_KEY in environment");
  }

  const url = "https://thehackernews.com/";
  const payload = {
    url,
    formats: ["links", "markdown", "html"],
    onlyMainContent: false,
  };

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);

  if (!res.ok) {
    console.log(text.slice(0, 500));
    throw new Error(`Firecrawl scrape failed with status ${res.status}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    console.error("Response was not valid JSON");
    console.error(text.slice(0, 500));
    throw err;
  }

  const links = Array.isArray(json.links) ? json.links : [];
  console.log(`links count: ${links.length}`);
  console.log("top-level keys:", Object.keys(json));
  if (Array.isArray(json.data)) {
    console.log(`data array length: ${json.data.length}`);
    if (json.data.length > 0) {
      console.log("data[0] keys:", Object.keys(json.data[0]));
      const docLinks = Array.isArray(json.data[0].links) ? json.data[0].links : [];
      console.log(`data[0].links count: ${docLinks.length}`);
      const docMetadata = json.data[0].metadata;
      if (docMetadata) {
        console.log("data[0].metadata keys:", Object.keys(docMetadata));
      }
    }
  } else {
    console.log("data is not an array:", typeof json.data);
    const dataString = JSON.stringify(json.data, null, 2);
    console.log("data preview:", dataString.slice(0, 1200));
    const articleMatches = [
      ...dataString.matchAll(
        /(https?:\/\/(?:www\.)?thehackernews\.com\/[^\s"'()]+?\.html)/gi,
      ),
    ];
    const cleaned = [];
    const seen = new Set();
    for (const match of articleMatches) {
      const normalized = normalizeArticleUrl(match[1]);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        cleaned.push(normalized);
      }
    }
    const articlesOnly = cleaned.filter(
      (url) =>
        /\d{4}\/\d{2}\//.test(new URL(url).pathname) &&
        !url.includes("/search/") &&
        !url.includes("/label/"),
    );
    console.log(`found ${articlesOnly.length} article-style URLs in data after cleanup`);
    console.log("sample article URLs:", articlesOnly.slice(0, 10));
    if (typeof json.data.markdown === "string") {
      console.log("markdown snippet:", json.data.markdown.slice(0, 800));
    }
  }
  if (json.documents && Array.isArray(json.documents) && json.documents.length > 0) {
    console.log("documents[0] keys:", Object.keys(json.documents[0]));
  }
  const preview = links.slice(0, 10).map((link, idx) => ({
    idx: idx + 1,
    title: link.title || link.text || "",
    url: link.url || link.href || link.link,
  }));
  console.log("preview:", preview);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
function normalizeArticleUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let working = rawUrl.trim();
  if (working === "") return null;
  const match = working.match(/https?:\/\/(?:www\.)?thehackernews\.com\/[^\s"'()]+?\.html/i);
  if (!match) return null;
  working = match[0];
  try {
    const absolute = new URL(working, "https://thehackernews.com/").toString();
    if (!absolute.toLowerCase().endsWith(".html")) return null;
    return absolute;
  } catch (_) {
    return null;
  }
}
