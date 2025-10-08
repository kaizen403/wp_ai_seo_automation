import { Hono } from "hono";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_STATE = {
  lastPublishedDateIST: null,
  lastPublishResult: null,
  isPublishing: false,
};
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// ----- environment helpers --------------------------------------------------
function getConfig(env) {
  const required = [
    "FIRECRAWL_API_KEY",
    "GROQ_API_KEY",
    "WP_SITE_URL",
    "WP_USER",
    "WP_APP_PASSWORD",
  ];
  for (const key of required) {
    const value = env[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Missing required environment variable ${key}`);
    }
  }
  return {
    firecrawlApiKey: env.FIRECRAWL_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    wpSiteUrl: env.WP_SITE_URL,
    wpUser: env.WP_USER,
    wpPassword: env.WP_APP_PASSWORD,
    groqModel: (env.GROQ_MODEL && env.GROQ_MODEL.trim()) || "openai/gpt-oss-120b",
    userAgent: env.HTTP_USER_AGENT || DEFAULT_USER_AGENT,
  };
}

// ----- common helpers -------------------------------------------------------
const pickFirstNonEmpty = (...values) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getISTComponents = (date = new Date()) => {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  const iso = istDate.toISOString();
  const dateKey = iso.split("T")[0];
  const hour = istDate.getUTCHours();
  const minute = istDate.getUTCMinutes();
  return { dateKey, hour, minute };
};

function normalizeDomainArticleUrl(rawUrl, { domain, requireHtmlExtension = false }) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let working = rawUrl.trim();
  if (working === "") return null;

  const match = working.match(/https?:\/\/[^\s"'()]+/i);
  if (match) working = match[0];

  if (requireHtmlExtension) {
    const lower = working.toLowerCase();
    const htmlIndex = lower.indexOf(".html");
    if (htmlIndex === -1) return null;
    working = working.slice(0, htmlIndex + 5);
  }

  try {
    const absolute = new URL(working, domain).toString();
    if (requireHtmlExtension && !absolute.toLowerCase().endsWith(".html")) return null;
    return absolute;
  } catch (_) {
    return null;
  }
}

function expandLinkCandidates(items) {
  if (!items) return [];
  const results = [];
  const visited = new Set();

  const visit = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      results.push({ url: value });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);

    const url = pickFirstNonEmpty(
      value.url,
      value.href,
      value.link,
      value.permalink,
      value.sourceURL,
    );
    const title = pickFirstNonEmpty(
      value.title,
      value.text,
      value.name,
      value.heading,
      value.label,
      value.description,
    );

    if (url || title) results.push({ url, title });

    for (const child of Object.values(value)) visit(child);
  };

  visit(items);
  return results;
}

function deriveTitleFromUrl(urlString, fallback = "Article") {
  try {
    const { pathname } = new URL(urlString);
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments.pop();
    if (!lastSegment) return fallback;
    const cleaned = lastSegment.replace(/\.[a-z]+$/i, "");
    const words = cleaned.replace(/[-_]+/g, " ").trim();
    if (!words) return fallback;
    return words.replace(/\b\w/g, (char) => char.toUpperCase());
  } catch (_) {
    return fallback;
  }
}

function normalizeHackerNewsLinks(items) {
  const candidates = Array.isArray(items) ? items : expandLinkCandidates(items);
  const list = [];
  const seen = new Set();

  const push = (title, url) => {
    const absolute = normalizeDomainArticleUrl(url, {
      domain: "https://thehackernews.com/",
      requireHtmlExtension: true,
    });
    if (!absolute) return;
    if (!absolute.includes("thehackernews.com")) return;
    const path = new URL(absolute).pathname.toLowerCase();
    if (!/\d{4}\/\d{2}\//.test(path)) return;
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const finalTitle =
      (title && title.trim()) || deriveTitleFromUrl(absolute, "The Hacker News Article");
    list.push({ title: finalTitle, url: absolute });
  };

  for (const item of candidates) {
    if (!item) continue;
    if (typeof item === "string") {
      push("", item);
      continue;
    }
    const candidateUrl = pickFirstNonEmpty(
      item.url,
      item.href,
      item.link,
      item.permalink,
      item.sourceURL,
    );
    const candidateTitle = pickFirstNonEmpty(
      item.title,
      item.text,
      item.name,
      item.heading,
      item.label,
      item.description,
    );
    push(candidateTitle, candidateUrl);
  }

  return list;
}

function extractMarkdownLinks(markdown, { baseUrl } = {}) {
  if (typeof markdown !== "string" || markdown.trim() === "") return [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let match;
  while ((match = regex.exec(markdown))) {
    const text = match[1]?.trim();
    const href = match[2]?.trim();
    if (!text || !href) continue;
    let absolute = href;
    if (baseUrl) {
      try {
        absolute = new URL(href, baseUrl).toString();
      } catch (_) {
        continue;
      }
    }
    links.push({ text, url: absolute });
  }
  return links;
}

function collectHackerNewsLinksFromMetadata(metadata) {
  return normalizeHackerNewsLinks(metadata);
}

function collectHackerNewsLinksFromHtml(html) {
  if (typeof html !== "string" || html.trim() === "") return [];
  const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  const tagsRegex = /<[^>]+>/g;
  const links = [];
  let match;
  while ((match = linkRegex.exec(html))) {
    const href = match[1];
    const text = match[2].replace(tagsRegex, "").trim();
    links.push({ url: href, title: text });
  }
  return normalizeHackerNewsLinks(links);
}

function collectHackerNewsLinksFromText(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const regex = /https?:\/\/(?:www\.)?thehackernews\.com\/[^\s"'()]+/gi;
  const matches = [];
  let match;
  while ((match = regex.exec(text))) {
    matches.push({ url: match[0] });
  }
  return normalizeHackerNewsLinks(matches);
}

function createLinkAggregator(normalizeFn) {
  const seen = new Set();
  const list = [];
  return {
    add(items) {
      const normalized = normalizeFn(items);
      for (const link of normalized) {
        if (seen.has(link.url)) continue;
        seen.add(link.url);
        list.push(link);
      }
    },
    all() {
      return list.slice();
    },
  };
}

function harvestHackerNewsScrape(scrape, aggregator) {
  if (!scrape || !aggregator) return;
  const markdown = pickFirstNonEmpty(scrape.summary, scrape.markdown, scrape.rawText);
  const html = scrape.html || "";
  const rawText = pickFirstNonEmpty(scrape.rawText, scrape.summary, "");

  aggregator.add(scrape.links);
  aggregator.add(collectHackerNewsLinksFromMetadata(scrape.metadata));
  aggregator.add(collectHackerNewsLinksFromHtml(html));
  aggregator.add(
    extractMarkdownLinks(markdown, { baseUrl: "https://thehackernews.com/" }).map(
      ({ text, url }) => ({ title: text, url }),
    ),
  );
  aggregator.add(collectHackerNewsLinksFromText(html));
  aggregator.add(collectHackerNewsLinksFromText(markdown));
  aggregator.add(collectHackerNewsLinksFromText(rawText));

  const documents = Array.isArray(scrape.documents) ? scrape.documents : [];
  for (const doc of documents) {
    if (!doc) continue;
    const docMarkdown = pickFirstNonEmpty(doc.summary, doc.markdown, doc.rawText);
    const docHtml = doc.html || "";
    const docRaw = pickFirstNonEmpty(doc.rawText, doc.summary, doc.markdown, "");
    aggregator.add(doc.links);
    aggregator.add(collectHackerNewsLinksFromMetadata(doc.metadata));
    aggregator.add(collectHackerNewsLinksFromHtml(docHtml));
    aggregator.add(collectHackerNewsLinksFromText(docRaw));
    aggregator.add(
      extractMarkdownLinks(docMarkdown, { baseUrl: "https://thehackernews.com/" }).map(
        ({ text, url }) => ({ title: text, url }),
      ),
    );
  }
}

// ----- firecrawl ------------------------------------------------------------
async function firecrawlScrape(env, url, { formats = ["summary", "html", "links"] } = {}) {
  const { firecrawlApiKey } = getConfig(env);
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firecrawlApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats, onlyMainContent: false }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firecrawl scrape ${res.status} ${text}`);
  const json = JSON.parse(text);
  if (json.error) throw new Error(String(json.error));
  const normalized = normalizeFirecrawlPayload(json);
  console.log(
    `firecrawlScrape: ${url} (docs=${normalized.documents.length}, links=${normalized.links.length})`,
  );
  return normalized;
}

async function firecrawlStartCrawl(env, url) {
  const { firecrawlApiKey } = getConfig(env);
  const res = await fetch(`${FIRECRAWL_BASE}/crawl`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firecrawlApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      limit: 1,
      crawlEntireDomain: false,
      scrapeOptions: {
        formats: ["summary", "html", "links"],
        onlyMainContent: false,
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firecrawl crawl start ${res.status} ${text}`);
  return JSON.parse(text);
}

async function firecrawlPoll(env, jobId, { timeoutMs = 45000, intervalMs = 1500 } = {}) {
  const { firecrawlApiKey } = getConfig(env);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${FIRECRAWL_BASE}/crawl/${jobId}`, {
      headers: { Authorization: `Bearer ${firecrawlApiKey}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Firecrawl poll ${res.status} ${text}`);
    const json = JSON.parse(text);
    const done =
      json.status === "completed" ||
      json.success === true ||
      Array.isArray(json.data) ||
      Array.isArray(json.documents);
    if (done) return json;
    await sleep(intervalMs);
  }
  throw new Error("Firecrawl poll timed out");
}

function normalizeFirecrawlPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      summary: "",
      markdown: "",
      html: "",
      title: "",
      description: "",
      rawText: "",
      metadata: null,
      links: [],
      documents: [],
    };
  }

  const documents = [];
  const visited = new Set();
  const addDoc = (doc) => {
    if (!doc || typeof doc !== "object") return;
    if (visited.has(doc)) return;
    visited.add(doc);
    documents.push(doc);
  };

  const arrayKeys = ["data", "documents", "results", "items", "records"];
  for (const key of arrayKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      for (const doc of value) addDoc(doc);
    } else if (value && typeof value === "object") {
      addDoc(value);
    }
  }

  if (payload.document && typeof payload.document === "object") addDoc(payload.document);
  if (documents.length === 0) addDoc(payload);

  const primary = documents[0] || {};
  const summary = pickFirstNonEmpty(primary.summary, payload.summary);
  const markdown = pickFirstNonEmpty(primary.markdown, payload.markdown);
  const html = pickFirstNonEmpty(primary.html, payload.html);
  const title = pickFirstNonEmpty(primary.title, payload.title);
  const description = pickFirstNonEmpty(primary.description, payload.description);
  const rawText = pickFirstNonEmpty(
    primary.rawText,
    primary.raw_text,
    primary.raw,
    primary.content,
    primary.text,
    payload.rawText,
    payload.raw_text,
    payload.raw,
    payload.content,
    payload.text,
  );

  const links = Array.isArray(primary.links)
    ? primary.links
    : Array.isArray(payload.links)
    ? payload.links
    : [];

  return {
    summary: summary || "",
    markdown: markdown || "",
    html: html || "",
    title: title || "",
    description: description || "",
    rawText: rawText || "",
    metadata: primary.metadata || payload.metadata || null,
    links,
    documents,
  };
}

async function firecrawlSummaryViaCrawl(env, url) {
  try {
    const scraped = await firecrawlScrape(env, url, { formats: ["summary", "html", "links"] });
    if (
      scraped.summary.length > 0 ||
      scraped.links.length > 0 ||
      scraped.html.length > 0 ||
      scraped.rawText.length > 0
    ) {
      console.log(`firecrawlSummaryViaCrawl: using scrape for ${url}`);
      return scraped;
    }
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes("not permitted")) throw err;
    console.warn(`firecrawlSummaryViaCrawl: scrape failed (${msg}); falling back to crawl`);
  }

  const started = await firecrawlStartCrawl(env, url);
  if (Array.isArray(started.data) && started.data.length > 0) {
    console.log(`firecrawlSummaryViaCrawl: immediate crawl data for ${url}`);
    return normalizeFirecrawlPayload(started);
  }

  const jobId = started.id || started.jobId || started.crawlId;
  if (!jobId) throw new Error("Firecrawl crawl did not return data or a job id");
  const polled = await firecrawlPoll(env, jobId);
  console.log(`firecrawlSummaryViaCrawl: polled crawl data for ${url}`);
  return normalizeFirecrawlPayload(polled);
}

// ----- Hacker News harvesting ----------------------------------------------
async function fetchHackerNewsArticles(env, limit = 16) {
  console.log("Fetching The Hacker News homepage...");
  const aggregator = createLinkAggregator(normalizeHackerNewsLinks);
  const scrape = await firecrawlSummaryViaCrawl(env, "https://thehackernews.com/");
  harvestHackerNewsScrape(scrape, aggregator);
  const links = aggregator
    .all()
    .filter((item) => {
      try {
        const path = new URL(item.url).pathname.toLowerCase();
        return /\d{4}\/\d{2}\//.test(path);
      } catch (_) {
        return false;
      }
    })
    .slice(0, limit);

  if (links.length === 0) throw new Error("No article links found on The Hacker News homepage");
  console.log(`Collected ${links.length} Hacker News article links`);
  return links;
}

async function selectHackerNewsArticle(env, { url, index } = {}) {
  if (url) {
    const normalized = normalizeDomainArticleUrl(url, {
      domain: "https://thehackernews.com/",
      requireHtmlExtension: true,
    });
    if (!normalized) throw new Error(`Provided URL is not a valid Hacker News article: ${url}`);
    return { url: normalized, title: deriveTitleFromUrl(normalized, "The Hacker News Article") };
  }

  const articles = await fetchHackerNewsArticles(env);
  const shortlist = articles.slice(0, Math.min(4, articles.length));
  if (shortlist.length === 0) throw new Error("No Hacker News articles available to select");

  let chosen;
  if (typeof index === "number" && index >= 0 && index < shortlist.length) {
    chosen = shortlist[index];
  } else {
    chosen = shortlist[Math.floor(Math.random() * shortlist.length)];
  }

  return chosen;
}

async function summarizeArticle(env, url) {
  const article = await firecrawlSummaryViaCrawl(env, url);
  const summaryText = pickFirstNonEmpty(article.summary, article.markdown, article.rawText);
  if (!summaryText) throw new Error(`Failed to extract summary from ${url}`);
  const articleTitle = pickFirstNonEmpty(article.title, deriveTitleFromUrl(url));
  return { summaryText, articleTitle };
}

// ----- Groq expansion -------------------------------------------------------
async function groqExpandToBlog(env, { sourceTitle, sourceUrl, summaryText }) {
  const { groqApiKey, groqModel } = getConfig(env);
  const systemPrompt = `You are a security analyst and technical writer.
Write a precise, well-structured cybersecurity blog post in valid HTML based on a source summary.
Sections:
<h2>TLDR</h2> two lines
<h2>What happened</h2>
<h2>Why it matters</h2>
<h2>Who is affected</h2>
<h2>How to check exposure</h2>
<h2>Fast mitigation</h2>
Rules: produce 2500 to 3000 words, short sentences, confident tone, no hype, and do not include a References heading.
Return compact JSON (single line, no code fences) with keys: "title" (an original headline, not copied from the source), "hook" (25 to 40 word teaser written by you), and "html" (the article body wrapped in HTML).`;

  const userPrompt = `Source title: ${sourceTitle}
Source url: ${sourceUrl}

Source summary:
${summaryText}

Write the post now in clean HTML. Use h2 for section headings and lists where useful.`;

  const payload = {
    model: groqModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
  };

  let lastErrorSnippet = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      const lowered = text.toLowerCase();
      const snippet = text.length > 300 ? `${text.slice(0, 300)}…` : text;
      lastErrorSnippet = snippet;
      if (res.status === 400 && lowered.includes("model_decommissioned")) {
        throw new Error(
          `Groq model '${groqModel}' has been decommissioned. Update GROQ_MODEL. Snippet: ${snippet}`,
        );
      }
      if (res.status >= 500 && attempt < 3) {
        console.warn(`Groq ${res.status} attempt ${attempt}; retrying...`);
        await sleep(1000 * attempt);
        continue;
      }
      throw new Error(`Groq ${res.status} ${snippet}`);
    }

    const json = JSON.parse(text);
    let content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Groq returned empty content");

    if (content.startsWith("```")) {
      content = content.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_) {
      const firstBrace = content.indexOf("{");
      const lastBrace = content.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error(`Groq response not JSON: ${content}`);
      }
    }

    const title = pickFirstNonEmpty(parsed.title, parsed.headline, sourceTitle)?.slice(0, 120);
    const hook = pickFirstNonEmpty(parsed.hook, parsed.description, parsed.preview);
    const html = pickFirstNonEmpty(parsed.html, parsed.body, parsed.content);

    if (!title) throw new Error("Groq JSON missing title");
    if (!hook) throw new Error("Groq JSON missing hook");
    if (!html) throw new Error("Groq JSON missing html");

    return { title, hook, html };
  }

  throw new Error(`Groq failed after retries: ${lastErrorSnippet}`);
}

// ----- WordPress publishing --------------------------------------------------
function basicAuthHeader(user, pass) {
  if (typeof btoa === "function") {
    return `Basic ${btoa(`${user}:${pass}`)}`;
  }
  if (typeof Buffer !== "undefined") {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }
  throw new Error("No base64 encoder available for basic auth");
}

async function wpCreatePost(env, { title, html, excerpt, status = "publish" }) {
  const { wpSiteUrl, wpUser, wpPassword, userAgent } = getConfig(env);
  const base = wpSiteUrl.replace(/\/+$/, "");
  const endpoint = `${base}/wp-json/wp/v2/posts`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(wpUser, wpPassword),
      "Content-Type": "application/json",
      "User-Agent": userAgent,
      Accept: "application/json",
    },
    body: JSON.stringify({
      title,
      status,
      content: html,
      excerpt: excerpt || "",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const snippet = text.slice(0, 400);
    if (res.status === 403) {
      throw new Error(
        `WP create 403 (possible Cloudflare or auth block) ${snippet}. Verify WordPress application password access for this automation.`,
      );
    }
    throw new Error(`WP create ${res.status} ${snippet}`);
  }
  return JSON.parse(text);
}

// ----- publishing pipeline --------------------------------------------------
async function performHackerNewsPublish(
  env,
  { url, index, publish = true, reason = "manual" } = {},
) {
  console.log(`\n=== Hacker News publish (${reason}) ===`);
  const selected = await selectHackerNewsArticle(env, { url, index });
  console.log(`Selected article: ${selected.title}\n${selected.url}`);

  const { summaryText, articleTitle } = await summarizeArticle(env, selected.url);
  console.log(`Summary length: ${summaryText.length} characters`);

  const { title, hook, html } = await groqExpandToBlog(env, {
    sourceTitle: articleTitle,
    sourceUrl: selected.url,
    summaryText,
  });
  console.log(`Generated blog title: ${title}`);

  let post = null;
  if (publish) {
    post = await wpCreatePost(env, { title, html, excerpt: hook, status: "publish" });
    console.log(`Published WordPress post ID ${post.id}`);
  } else {
    console.log("Preview mode: skipping WordPress publish");
  }

  return {
    published: publish,
    sourceUrl: selected.url,
    sourceTitle: articleTitle,
    generatedTitle: title,
    generatedHook: hook,
    wordpressPost: publish ? { id: post.id, link: post.link, status: post.status } : null,
  };
}

// ----- Durable Object state -------------------------------------------------
async function getPublishState(env) {
  if (!env.PUBLISH_STATE) throw new Error("Missing Durable Object binding PUBLISH_STATE");
  const id = env.PUBLISH_STATE.idFromName("global");
  const stub = env.PUBLISH_STATE.get(id);
  const res = await stub.fetch("https://publish-state/get");
  if (!res.ok) throw new Error(`Publish state get failed ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return { stub, state: { ...DEFAULT_STATE, ...(data || {}) } };
}

async function savePublishState(stub, state) {
  await stub.fetch("https://publish-state/set", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...DEFAULT_STATE, ...state }),
  });
}

async function performPublishWithLock(env, options = {}) {
  const { stub: providedStub, state: providedState, ...publishOptions } = options;
  const { stub, state } = providedStub && providedState
    ? { stub: providedStub, state: providedState }
    : await getPublishState(env);
  const current = { ...DEFAULT_STATE, ...state };

  if (current.isPublishing) throw new Error("Publish already in progress");
  await savePublishState(stub, { ...current, isPublishing: true });

  const publishFlag = publishOptions.publish !== false;
  const reason = publishOptions.reason || "manual";
  let result = null;
  let error = null;

  try {
    result = await performHackerNewsPublish(env, publishOptions);
  } catch (err) {
    error = err;
  }

  const finalState = { ...current, isPublishing: false };
  if (error) {
    finalState.lastPublishResult = {
      ok: false,
      reason,
      completedAt: new Date().toISOString(),
      error: String(error?.message || error),
    };
  } else if (result) {
    const { dateKey } = getISTComponents();
    if (publishFlag) {
      finalState.lastPublishedDateIST = dateKey;
    }
    finalState.lastPublishResult = {
      ok: true,
      reason,
      completedAt: new Date().toISOString(),
      ...result,
    };
  }

  await savePublishState(stub, finalState);

  if (error) throw error;
  return result;
}

async function runDailyPublish(env, { reason = "cron", force = false } = {}) {
  const { stub, state } = await getPublishState(env);
  const current = { ...DEFAULT_STATE, ...state };
  const { dateKey } = getISTComponents();
  if (!force && current.lastPublishedDateIST === dateKey) {
    console.log(`Daily publish already completed for ${dateKey} IST; skipping.`);
    return { skipped: true };
  }
  return await performPublishWithLock(env, { publish: true, reason, stub, state: current });
}

// ----- Hono app -------------------------------------------------------------
const app = new Hono();

app.get("/healthz", async (c) => {
  const { state } = await getPublishState(c.env);
  return c.json({ ok: true, state });
});

app.get("/publish-log", async (c) => {
  const { state } = await getPublishState(c.env);
  if (!state.lastPublishResult) {
    return c.json({ ok: true, message: "No publish recorded yet" });
  }
  return c.json({ ok: true, lastPublishResult: state.lastPublishResult });
});

app.get("/hackernews-links", async (c) => {
  try {
    const articles = await fetchHackerNewsArticles(c.env, 12);
    return c.json({ ok: true, count: articles.length, articles });
  } catch (err) {
    console.error("Failed to fetch Hacker News links", err);
    return c.json({ ok: false, error: String(err?.message || err) }, 500);
  }
});

app.post("/publish-hackernews", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const publish = body.publish !== false;
    const url = typeof body.url === "string" ? body.url : undefined;
    const index =
      typeof body.index === "number" && Number.isInteger(body.index) ? body.index : undefined;
    const reason = publish ? "manual" : "preview";

    const { stub, state } = await getPublishState(c.env);
    const result = await performPublishWithLock(c.env, {
      url,
      index,
      publish,
      reason,
      stub,
      state,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error("Manual publish failed", err);
    return c.json({ ok: false, error: String(err?.message || err) }, 500);
  }
});

app.post("/publish-reset", async (c) => {
  const { stub } = await getPublishState(c.env);
  await savePublishState(stub, { ...DEFAULT_STATE });
  return c.json({ ok: true, message: "Publish state reset" });
});

// ----- Worker exports -------------------------------------------------------
export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    try {
      await runDailyPublish(env, { reason: "cron" });
    } catch (err) {
      console.error("Scheduled publish failed", err);
    }
  },
};

// ----- Durable Object -------------------------------------------------------
export class PublishState {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/get") {
      const stored = (await this.storage.get("state")) || DEFAULT_STATE;
      return new Response(JSON.stringify({ ...DEFAULT_STATE, ...stored }), {
        headers: JSON_HEADERS,
      });
    }
    if (url.pathname === "/set" && request.method === "POST") {
      const body = await request.json();
      await this.storage.put("state", { ...DEFAULT_STATE, ...body });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }
    return new Response("Not found", { status: 404 });
  }
}
