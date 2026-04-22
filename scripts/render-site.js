const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT, "content.md");
const OUTPUT_PATH = path.join(ROOT, "index.html");
const CSS_TEMPLATE_PATH = path.join(ROOT, "references", "japanese-photo-theme.css");

const gradientMap = {
  "mist-blue-pink":
    "linear-gradient(135deg, rgba(184, 202, 214, 0.32), rgba(233, 201, 205, 0.30))",
  "blush-wood":
    "linear-gradient(135deg, rgba(233, 201, 205, 0.34), rgba(219, 198, 176, 0.28))",
  "sage-mist":
    "linear-gradient(135deg, rgba(205, 217, 207, 0.34), rgba(184, 202, 214, 0.28))",
  "warm-paper":
    "linear-gradient(135deg, rgba(249, 246, 241, 0.95), rgba(219, 198, 176, 0.20))",
};

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "untitled-section";
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---")) {
    return { data: {}, body: markdown };
  }

  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: markdown };
  }

  return {
    data: parseYamlSubset(match[1]),
    body: match[2],
  };
}

function parseYamlSubset(block) {
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;

    if (!rawValue) {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
      continue;
    }

    parent[key] = parseScalar(rawValue);
  }

  return root;
}

function parseScalar(value) {
  const normalized = value.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function tokensToHtml(tokens) {
  return marked.parser(tokens);
}

function consumeUntilHeading(tokens, startIndex, depth) {
  const bucket = [];
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === "heading" && token.depth <= depth) break;
    bucket.push(token);
    index += 1;
  }

  return { tokens: bucket, nextIndex: index };
}

function splitByHeading(tokens, depth) {
  const groups = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === "heading" && token.depth === depth) {
      const body = consumeUntilHeading(tokens, index + 1, depth);
      groups.push({ heading: token.text.trim(), tokens: body.tokens });
      index = body.nextIndex;
      continue;
    }
    index += 1;
  }

  return groups;
}

function tokensBeforeHeading(tokens, depth) {
  const bucket = [];
  for (const token of tokens) {
    if (token.type === "heading" && token.depth === depth) break;
    bucket.push(token);
  }
  return bucket;
}

function parseMeta(input = "") {
  return input
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split("=");
      if (!key || rest.length === 0) return acc;
      acc[key.trim()] = rest.join("=").trim();
      return acc;
    }, {});
}

function flattenText(tokens) {
  return tokens
    .filter((token) => token.type === "paragraph" || token.type === "blockquote")
    .map((token) => token.text || "")
    .join(" ")
    .trim();
}

function pickSectionKey(title) {
  if (title.includes("關於")) return "about";
  if (title.includes("相簿") || title.includes("作品")) return "albums";
  if (title.includes("心得") || title.includes("心路")) return "journey";
  if (title.includes("故事") || title.includes("網誌")) return "journal";
  if (title.includes("社群") || title.includes("聯絡")) return "connect";
  return slugify(title);
}

function buildSections(tokens) {
  return splitByHeading(tokens, 2).map((group) => ({
    id: pickSectionKey(group.heading),
    title: group.heading,
    tokens: group.tokens,
    html: tokensToHtml(group.tokens),
  }));
}

function parsePortfolioCard(group) {
  let imageToken = null;
  let tableToken = null;
  let listToken = null;
  const contentTokens = [];

  for (const token of group.tokens) {
    if (token.type === "paragraph" && token.tokens) {
      const imageChild = token.tokens.find((child) => child.type === "image");
      if (imageChild && !imageToken) {
        imageToken = imageChild;
        continue;
      }
    }

    if (token.type === "table" && !tableToken) {
      tableToken = token;
      continue;
    }

    if (token.type === "list" && !listToken) {
      listToken = token;
      continue;
    }

    contentTokens.push(token);
  }

  const meta = parseMeta(imageToken?.title || "");
  const gradient = gradientMap[meta.gradient] || gradientMap["warm-paper"];

  return {
    title: group.heading,
    image: imageToken
      ? { src: imageToken.href, alt: imageToken.text || group.heading }
      : null,
    category: meta.category || "Photography Theme",
    accent: meta.accent || "Quiet Gradient",
    gradient,
    bodyHtml: tokensToHtml(contentTokens),
    tableHtml: tableToken ? tokensToHtml([tableToken]) : "",
    listHtml: listToken ? tokensToHtml([listToken]) : "",
  };
}

function renderAboutSection(section) {
  return `
    <section class="panel section" id="${section.id}">
      <div class="section-header">
        <div>
          <div class="eyebrow">About Me</div>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <p>這個區塊會把 Markdown 的自我介紹、器材表格與補充說明，整理成溫和留白的資訊卡版型。</p>
      </div>
      <div class="prose-card markdown-body">${section.html}</div>
    </section>
  `;
}

function renderAlbumsSection(section) {
  const introTokens = tokensBeforeHeading(section.tokens, 3);
  const cards = splitByHeading(section.tokens, 3).map(parsePortfolioCard);

  return `
    <section class="panel section" id="${section.id}">
      <div class="section-header">
        <div>
          <div class="eyebrow">Theme Albums</div>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <p>每個 <code>###</code> 會被轉成單張作品卡，並讀取圖片 title 中的漸層與分類屬性。</p>
      </div>
      ${introTokens.length ? `<div class="portfolio-intro markdown-body">${tokensToHtml(introTokens)}</div>` : ""}
      <div class="work-grid">
        ${cards
          .map(
            (card) => `
              <article class="work-card">
                <div class="work-card__image" style="background:${card.gradient}">
                  ${card.image ? `<img src="${escapeHtml(card.image.src)}" alt="${escapeHtml(card.image.alt)}">` : ""}
                </div>
                <div class="work-card__body">
                  <div class="work-card__meta">
                    <span>${escapeHtml(card.category)}</span>
                    <strong>${escapeHtml(card.accent)}</strong>
                  </div>
                  <h4>${escapeHtml(card.title)}</h4>
                  <div class="markdown-body">${card.bodyHtml}</div>
                  ${card.tableHtml ? `<div class="camera-table markdown-body">${card.tableHtml}</div>` : ""}
                  ${card.listHtml ? `<div class="tips-list markdown-body">${card.listHtml}</div>` : ""}
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderJourneySection(section) {
  return `
    <section class="panel section" id="${section.id}">
      <div class="section-header">
        <div>
          <div class="eyebrow">Photo Notes</div>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <p>列點語法會保留成攝影心得與工作筆記，適合放你的觀察、練習重點與拍攝節奏。</p>
      </div>
      <div class="story-card markdown-body">${section.html}</div>
    </section>
  `;
}

function renderJournalSection(section) {
  const entries = splitByHeading(section.tokens, 3);
  return `
    <section class="panel section" id="${section.id}">
      <div class="section-header">
        <div>
          <div class="eyebrow">Story & Journal</div>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <p>你可以把拍攝計畫、故事片段或系列更新寫成獨立文章，頁面會自動整理成網誌卡片。</p>
      </div>
      <div class="journal-grid">
        ${entries
          .map((entry) => {
            const firstParagraph = entry.tokens.find((token) => token.type === "paragraph");
            const firstIndex = firstParagraph ? entry.tokens.indexOf(firstParagraph) : -1;
            const maybeDate = firstParagraph ? firstParagraph.text.trim() : "";
            const dateText = /^\d{4}\.\d{2}\.\d{2}$/.test(maybeDate) ? maybeDate : "";
            const bodyTokens = dateText ? entry.tokens.slice(firstIndex + 1) : entry.tokens;
            return `
              <article class="journal-card">
                ${dateText ? `<time datetime="${dateText.replace(/\./g, "-")}">${escapeHtml(dateText)}</time>` : ""}
                <h4>${escapeHtml(entry.heading)}</h4>
                <div class="markdown-body">${tokensToHtml(bodyTokens)}</div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function socialGlyph(name) {
  if (name === "facebook") return "f";
  if (name === "youtube") return "▶";
  if (name === "medium") return "M";
  return "•";
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderConnectSection(section, frontmatter) {
  const social = frontmatter.social || {};
  const links = [
    ["facebook", social.facebook || ""],
    ["youtube", social.youtube || ""],
    ["medium", social.medium || ""],
  ].filter(([, href]) => href);

  return `
    <section class="panel follow" id="${section.id}">
      <div class="follow__grid">
        <div>
          <div class="eyebrow">Connect / Follow Me</div>
          <h3>${escapeHtml(section.title)}</h3>
          <div class="markdown-body">${section.html}</div>
        </div>
        <div class="social-links">
          ${links
            .map(
              ([name, href]) => `
                <a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
                  <span class="icon icon--${name}">${socialGlyph(name)}</span>
                  ${capitalize(name)}
                </a>
              `
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderGenericSection(section) {
  return `
    <section class="panel section" id="${section.id}">
      <div class="section-header">
        <div>
          <div class="eyebrow">Section</div>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
      </div>
      <div class="prose-card markdown-body">${section.html}</div>
    </section>
  `;
}

function renderSection(section, frontmatter) {
  if (section.id === "about") return renderAboutSection(section);
  if (section.id === "albums") return renderAlbumsSection(section);
  if (section.id === "journey") return renderJourneySection(section);
  if (section.id === "journal") return renderJournalSection(section);
  if (section.id === "connect") return renderConnectSection(section, frontmatter);
  return renderGenericSection(section);
}

function buildHtml(markdown) {
  const { data: frontmatter, body } = parseFrontmatter(markdown);
  const tokens = marked.lexer(body);
  const sections = buildSections(tokens);
  const css = fs.readFileSync(CSS_TEMPLATE_PATH, "utf8");
  const title = frontmatter.title || "東京街拍";
  const tagline = frontmatter.tagline || "在光與影之間，留住永恆的一瞬。";
  const subtitle =
    frontmatter.subtitle || "Japanese gradient portfolio generated from a structured Markdown workflow.";
  const heroImage =
    frontmatter.cover_image ||
    "https://via.placeholder.com/900x1100/EDF2F4/4A4A4A?text=Photography+Portfolio+Cover";
  const heroGradient =
    gradientMap[frontmatter.hero_gradient] || gradientMap["mist-blue-pink"];

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${css}
  </style>
</head>
<body>
  <aside class="sidebar">
    <div>
      <div class="sidebar__brand">
        <small>Photography Web Skill</small>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <nav aria-label="側邊欄目錄">
        ${sections.map((section) => `<a href="#${section.id}">${escapeHtml(section.title)}</a>`).join("")}
      </nav>
    </div>
    <div class="sidebar__note">
      內容來自 <code>content.md</code>，頁面由 GitHub Actions 自動產生。你可以專心維持 Markdown，網站會自動更新。
    </div>
  </aside>
  <main>
    <div class="container">
      <section class="panel hero" id="top">
        <div class="hero__content">
          <div class="eyebrow">Japanese Gradient Portfolio</div>
          <h2 class="gradient-text">${escapeHtml(title)}</h2>
          <p class="hero__summary">${escapeHtml(subtitle)}</p>
          <blockquote>${escapeHtml(tagline)}</blockquote>
          <div class="hero__actions">
            <a class="button button--primary" href="#albums">瀏覽主題相簿</a>
            <a class="button button--ghost" href="#connect">Connect / Follow Me</a>
          </div>
        </div>
        <div class="hero__aside">
          <div class="hero__card">
            <div class="hero__sample" style="background:${heroGradient}">
              <img src="${escapeHtml(heroImage)}" alt="主視覺占位圖">
            </div>
            <h3>Theme Overview</h3>
            <p class="markdown-body">${escapeHtml(flattenText(tokens).slice(0, 120) || subtitle)}</p>
          </div>
          <div class="hero__meta">
            <div>
              <strong>${sections.length}</strong>
              Sections
            </div>
            <div>
              <strong>${sections.find((section) => section.id === "albums") ? splitByHeading(sections.find((section) => section.id === "albums").tokens, 3).length : 0}</strong>
              Works
            </div>
            <div>
              <strong>MD</strong>
              Auto Render
            </div>
          </div>
        </div>
      </section>
      ${sections.map((section) => renderSection(section, frontmatter)).join("")}
      <footer>
        Generated from structured Markdown by GitHub Actions.
      </footer>
    </div>
  </main>
</body>
</html>`;
}

function main() {
  const markdown = fs.readFileSync(CONTENT_PATH, "utf8");
  const html = buildHtml(markdown);
  fs.writeFileSync(OUTPUT_PATH, html, "utf8");
  console.log(`Rendered ${OUTPUT_PATH}`);
}

main();
