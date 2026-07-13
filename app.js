const state = {
  results: [],
  activeId: null,
  query: "",
  scope: "all",
  abilityType: "",
  statSortMode: "count",
  currentStats: null,
  currentEvalStats: null,
  documentMeta: null,
  documentListQuery: "",
  currentDocument: null,
  currentDocumentQuery: "",
  currentDocumentMatchIndex: -1,
  evaluationMethodology: null,
  activeTab: "card-search", // "card-search" | "eval" | "docs"
  cardDisplayMode: "stats", // "stats" | "detail"
  evalDisplayMode: "list",  // "list" | "stats"
  mobileActivePage: "filter", // "filter" | "list" | "detail"
};

const els = {
  workspace: document.querySelector(".workspace"),
  siteVersion: document.querySelector("#siteVersion"),
  dbMeta: document.querySelector("#dbMeta"),

  // Tab buttons
  tabCard: document.querySelector("#tabCard"),
  tabEval: document.querySelector("#tabEval"),
  tabDocs: document.querySelector("#tabDocs"),

  // Tab panels
  cardSearchPanel: document.querySelector("#cardSearchPanel"),
  evalPanel: document.querySelector("#evalPanel"),
  docsPanel: document.querySelector("#docsPanel"),

  // ① Card search panel elements
  cardQ: document.querySelector("#cardQ"),
  cardScope: document.querySelector("#cardScope"),
  cardAbilityTypeField: document.querySelector("#cardAbilityTypeField"),
  cardAbilityType: document.querySelector("#cardAbilityType"),
  cardExclusive: document.querySelector("#cardExclusive"),
  cardIdentity: document.querySelector("#cardIdentity"),
  cardCategory: document.querySelector("#cardCategory"),
  cardAuthor: document.querySelector("#cardAuthor"),
  cardSort: document.querySelector("#cardSort"),
  cardLimit: document.querySelector("#cardLimit"),
  cardSearchBtn: document.querySelector("#cardSearchBtn"),
  cardResetBtn: document.querySelector("#cardResetBtn"),

  // ③ Eval panel elements
  evalSearchControls: document.querySelector("#evalSearchControls"),
  evalQ: document.querySelector("#evalQ"),
  evalScope: document.querySelector("#evalScope"),
  evalCategory: document.querySelector("#evalCategory"),
  evalAuthor: document.querySelector("#evalAuthor"),
  evalSearchBtn: document.querySelector("#evalSearchBtn"),
  evalResetBtn: document.querySelector("#evalResetBtn"),

  // ④ Docs panel elements
  docsSidebarList: document.querySelector("#docsSidebarList"),

  // Shared output elements
  stats: document.querySelector("#statsPanel"),
  count: document.querySelector("#resultCount"),
  results: document.querySelector("#resultsList"),
  empty: document.querySelector("#emptyState"),
  detail: document.querySelector("#cardDetail"),

  // Mobile tab buttons
  mTabFilter: document.querySelector("#mTabFilter"),
  mTabList: document.querySelector("#mTabList"),
  mTabDetail: document.querySelector("#mTabDetail"),
};

const STATIC_DATA = window.CARD_BROWSER_STATIC_DATA || null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categoryClass(value) {
  return `cat-${String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function highlight(value, fieldScope = "all") {
  const text = escapeHtml(value ?? "");
  const q = state.query.trim();
  if (!q) return text;
  
  let shouldHighlight = false;
  if (state.scope === "all") {
    shouldHighlight = true;
  } else if (state.scope === fieldScope) {
    shouldHighlight = true;
  } else if (state.scope === "ability") {
    if (fieldScope.startsWith("ability")) {
      if (state.abilityType) {
        shouldHighlight = fieldScope === `ability:${state.abilityType}`;
      } else {
        shouldHighlight = true;
      }
    }
  }
  
  if (!shouldHighlight) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), (match) => `<mark>${match}</mark>`);
}

function setDocumentMode(enabled) {
  document.body.classList.toggle("document-mode", Boolean(enabled));
  els.workspace.classList.toggle("document-mode", Boolean(enabled));
}

function compact(value, length = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

async function getJson(url) {
  if (STATIC_DATA) {
    return getStaticJson(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function normalizeTitle(value) {
  return String(value || "").replaceAll("（", "(").replaceAll("）", ")").replace(/\s+/g, "");
}

function contains(value, q) {
  return String(value ?? "").includes(q);
}

function containsAny(values, q) {
  return values.some((value) => {
    if (Array.isArray(value)) return containsAny(value, q);
    if (value && typeof value === "object") return containsAny(Object.values(value), q);
    return contains(value, q);
  });
}

function textSnippets(content, q, limit = 3, radius = 70) {
  const text = String(content || "");
  const query = String(q || "").trim();
  if (!query) return [];
  const snippets = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let start = 0;
  while (snippets.length < limit) {
    const index = lowerText.indexOf(lowerQuery, start);
    if (index === -1) break;
    const left = Math.max(0, index - radius);
    const right = Math.min(text.length, index + query.length + radius);
    let snippet = text.slice(left, right).replace(/\s+/g, " ").trim();
    if (left > 0) snippet = `...${snippet}`;
    if (right < text.length) snippet = `${snippet}...`;
    snippets.push(snippet);
    start = index + query.length;
  }
  return snippets;
}

function staticMatchesScope(card, q, scope, abilityType = "", isExclusive = false, isIdentity = false) {
  const nq = normalizeTitle(q);
  let abilities = Array.isArray(card.abilities) ? card.abilities : [];
  const units = Array.isArray(card.units) ? card.units : [];
  
  if (isExclusive) {
    abilities = abilities.filter(abilityIsExclusive);
  }
  if (isIdentity) {
    abilities = abilities.filter(abilityIsIdentity);
  }

  if (!q) {
    if (scope === "ability" && abilityType) {
      return abilities.some((ability) => ability.kind === abilityType);
    }
    if (isExclusive || isIdentity) {
      return abilities.length > 0;
    }
    return true;
  }
  
  if (scope === "title") return contains(card.title, q) || contains(card.normalized_title, nq);
  if (scope === "identity") {
    return containsAny([card.identity, abilities.map((item) => item.owner_identity), units.map((unit) => [unit.identity, unit.entity_kind])], q);
  }
  if (scope === "weapons") {
    return containsAny([card.weapons, abilities.map((item) => item.owner_weapons), units.map((unit) => unit.weapons)], q);
  }
  if (scope === "source_work") return contains(card.source_work, q);
  if (scope === "relationships") return containsAny([card.relationships, units.map((unit) => unit.relationships)], q);
  if (scope === "ability") {
    return abilities.some((ability) => {
      if (abilityType && ability.kind !== abilityType) return false;
      return containsAny([ability.kind, ability.name, ability.raw_name, ability.type_prefix, ability.text], q);
    });
  }
  return containsAny([
    card.title,
    card.normalized_title,
    card.description,
    card.relationships,
    card.identity,
    card.weapons,
    card.source_work,
    card.author_group,
    abilities.map(a => `${a.kind} ${a.name} ${a.text}`),
    units,
  ], q);
}

function staticSnippet(card, scope) {
  if (scope === "identity") return card.identity || card.snippet;
  if (scope === "weapons") return card.weapons || card.snippet;
  if (scope === "source_work") return card.source_work || card.snippet;
  if (scope === "relationships") return card.relationships || card.snippet;
  return card.snippet || card.description || card.relationships || card.all_text || "";
}

function staticSummary(card, scope) {
  return {
    id: card.id,
    title: card.title,
    category: card.category,
    category_label: card.category_label,
    source_sheet: card.source_sheet,
    source_row: card.source_row,
    author_group: card.author_group,
    source_work: card.source_work,
    life: card.life,
    identity: card.identity,
    weapons: card.weapons,
    description: card.description,
    relationships: card.relationships,
    snippet: staticSnippet(card, scope),
  };
}

function compareStaticCards(a, b, sort, q) {
  if (q) {
    const nq = normalizeTitle(q);
    const rank = (card) => {
      if (card.title === q) return 0;
      if (card.normalized_title === nq) return 1;
      if (contains(card.title, q)) return 2;
      return 3;
    };
    const byRank = rank(a) - rank(b);
    if (byRank) return byRank;
  }
  if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans");
  if (sort === "category") {
    const byCategory = String(a.category || "").localeCompare(String(b.category || ""));
    if (byCategory) return byCategory;
  }
  return String(a.source_sheet || "").localeCompare(String(b.source_sheet || ""), "zh-Hans")
    || Number(a.source_row || 0) - Number(b.source_row || 0);
}

function staticFilteredCards({ q = "", scope = "all", abilityType = "", category = "", author = "", isExclusive = false, isIdentity = false } = {}) {
  return Object.values(STATIC_DATA.cards)
    .filter((card) => category ? card.category === category : card.category !== "deprecated")
    .filter((card) => author ? card.author_group === author : true)
    .filter((card) => staticMatchesScope(card, q, scope, abilityType, isExclusive, isIdentity));
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item) || "未标";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function abilityIsExclusive(ability) {
  const name = String(ability?.name || "");
  return name.includes("【") && name.includes("】");
}

function abilityIsIdentity(ability) {
  return /[（(]身份[）)]\s*$/.test(String(ability?.text || "").trim()) || /[（(]身份[）)]\s*$/.test(String(ability?.name || "").trim());
}

function staticStatQuery(params) {
  const cards = staticFilteredCards(params);
  const abilities = cards.flatMap((card) => Array.isArray(card.abilities) ? card.abilities : []);
  return {
    filters: params,
    card_count: cards.length,
    ability_count: abilities.length,
    exclusive_ability_count: abilities.filter(abilityIsExclusive).length,
    identity_ability_count: abilities.filter(abilityIsIdentity).length,
    category_counts: countBy(cards, (card) => card.category_label || card.category),
    author_counts: countBy(cards, (card) => card.author_group),
    source_work_counts: countBy(cards, (card) => card.source_work),
    ability_kind_counts: countBy(abilities, (ability) => ability.kind),
  };
}

function getStaticJson(url) {
  const parsed = new URL(url, window.location.href);
  if (parsed.pathname.endsWith("/api/meta")) {
    return Promise.resolve({ ...(STATIC_DATA.meta || {}), ...(STATIC_DATA.document_meta || {}) });
  }
  if (parsed.pathname.endsWith("/api/statistics")) {
    return Promise.resolve(STATIC_DATA.statistics || {});
  }
  if (parsed.pathname.endsWith("/api/documents")) {
    return Promise.resolve({ ...(STATIC_DATA.document_meta || {}), documents: STATIC_DATA.documents || [] });
  }
  if (parsed.pathname.endsWith("/api/document-search")) {
    const q = (parsed.searchParams.get("q") || "").trim();
    const docs = STATIC_DATA.documents || [];
    const results = docs
      .filter((document) => {
        if (!q) return true;
        return containsAny([document.title, document.description, document.group, document.path, document.content], q);
      })
      .map((document) => ({
        ...document,
        snippets: q ? textSnippets(document.content, q) : [],
        match_count: q ? String(document.content || "").toLowerCase().split(q.toLowerCase()).length - 1 : 0,
      }));
    return Promise.resolve({ results });
  }
  const documentMatch = parsed.pathname.match(/\/api\/document\/([^/]+)$/);
  if (documentMatch) {
    const id = decodeURIComponent(documentMatch[1]);
    const document = (STATIC_DATA.documents || []).find((item) => item.id === id);
    if (!document) return Promise.reject(new Error("未找到资料"));
    return Promise.resolve(document);
  }
  if (parsed.pathname.endsWith("/api/stat-query")) {
    return Promise.resolve(staticStatQuery({
      q: (parsed.searchParams.get("q") || "").trim(),
      scope: parsed.searchParams.get("scope") || "all",
      abilityType: parsed.searchParams.get("ability_type") || "",
      category: parsed.searchParams.get("category") || "",
      author: parsed.searchParams.get("author") || "",
      isExclusive: parsed.searchParams.get("is_exclusive") === "1",
      isIdentity: parsed.searchParams.get("is_identity") === "1",
    }));
  }
  if (parsed.pathname.endsWith("/api/evaluation-stats")) {
    return Promise.resolve(STATIC_DATA.evaluation_stats || {});
  }
  if (parsed.pathname.endsWith("/api/evaluation-search")) {
    const q = (parsed.searchParams.get("q") || "").trim().toLowerCase();
    const scope = parsed.searchParams.get("scope") || "all";
    const category = parsed.searchParams.get("category") || "";
    const author = parsed.searchParams.get("author") || "";
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") || 500), 1), 500);
    const valuesForScope = (item) => {
      const summary = item.summary || {};
      const survival = summary.survival || {};
      const risks = summary.risks || {};
      const fields = {
        title: item.title || "",
        positioning: `${summary.core_positioning || ""}\n${summary.overall || ""}`,
        survival: JSON.stringify(survival),
        pros: (summary.pros || []).join("\n"),
        cons: (summary.cons || []).join("\n"),
        questions: (summary.questions || []).map((entry) => entry.question || "").join("\n"),
        rules_risk: JSON.stringify(risks.rules || ""),
        digital_risk: JSON.stringify(risks.digital || ""),
        full_text: item.full_text || "",
      };
      return scope === "all" ? Object.values(fields).join("\n") : fields[scope] || "";
    };
    const results = (STATIC_DATA.evaluation_entries || [])
      .filter((item) => category ? item.category === category : true)
      .filter((item) => author ? item.author_group === author : true)
      .filter((item) => !q || valuesForScope(item).toLowerCase().includes(q))
      .slice(0, limit);
    return Promise.resolve({ results, reviewed_count: (STATIC_DATA.evaluation_entries || []).length });
  }
  if (parsed.pathname.endsWith("/api/search")) {
    const q = (parsed.searchParams.get("q") || "").trim();
    const scope = parsed.searchParams.get("scope") || "all";
    const abilityType = parsed.searchParams.get("ability_type") || "";
    const category = parsed.searchParams.get("category") || "";
    const author = parsed.searchParams.get("author") || "";
    const sort = parsed.searchParams.get("sort") || "sheet";
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") || 60), 1), 500);
    const isExclusive = parsed.searchParams.get("is_exclusive") === "1";
    const isIdentity = parsed.searchParams.get("is_identity") === "1";
    const cards = staticFilteredCards({ q, scope, abilityType, category, author, isExclusive, isIdentity })
      .sort((a, b) => compareStaticCards(a, b, sort, q))
      .slice(0, limit)
      .map((card) => staticSummary(card, scope));
    return Promise.resolve({ results: cards });
  }
  const cardMatch = parsed.pathname.match(/\/api\/card\/([^/]+)$/);
  if (cardMatch) {
    const id = decodeURIComponent(cardMatch[1]);
    if (!STATIC_DATA.cards[id]) return Promise.reject(new Error("未找到卡牌"));
    return Promise.resolve(STATIC_DATA.cards[id]);
  }
  return Promise.reject(new Error(`静态快照不支持此接口：${url}`));
}

function option(label, value = label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

async function loadMeta() {
  const meta = await getJson("/api/meta");
  state.evaluationMethodology = meta.evaluation_methodology || null;
  let versionMeta = meta;
  if (!versionMeta.library_version && !versionMeta.site_version) {
    try {
      versionMeta = { ...versionMeta, ...(await getJson("/api/documents")) };
    } catch (error) {
      console.warn("Document version metadata unavailable", error);
    }
  }
  const versionParts = [];
  if (versionMeta.library_version) versionParts.push(`\u8d44\u6599\u5e93 v${versionMeta.library_version}`);
  if (versionMeta.site_version) versionParts.push(`\u7f51\u9875 v${versionMeta.site_version}`);
  if (versionMeta.updated) versionParts.push(`\u66f4\u65b0\uff1a${versionMeta.updated}`);
  if (els.siteVersion) {
    els.siteVersion.textContent = versionParts.length ? versionParts.join(" \u00b7 ") : "\u672c\u5730\u7248";
  }
  els.dbMeta.textContent = `${meta.record_count} \u5f20\uff0c${meta.source_workbook}`;
  els.stats.innerHTML = meta.by_category
    .map((row) => `<div>${escapeHtml(row.category_label)}\uff1a${row.count}</div>`)
    .join("");

  // Populate category + author for all 2 panels (card search, eval)
  const categorySelects = [els.cardCategory, els.evalCategory];
  const authorSelects = [els.cardAuthor, els.evalAuthor];
  categorySelects.forEach((sel) => {
    if (!sel) return;
    sel.append(option("\u5168\u90e8", ""));
    meta.categories.forEach((item) => sel.append(option(item.label, item.value)));
  });
  authorSelects.forEach((sel) => {
    if (!sel) return;
    sel.append(option("\u5168\u90e8", ""));
    meta.authors.forEach((name) => sel.append(option(name, name)));
  });
}

function renderResults() {
  els.count.textContent = `${state.results.length} \u6761`;
  els.results.innerHTML = "";

  if (state.results.length === 0) {
    els.results.innerHTML = '<div class="empty-state">\u6ca1\u6709\u5339\u914d\u7ed3\u679c</div>';
    return;
  }

  const isEval = state.activeTab === "eval" && state.evalDisplayMode === "list";
  const fragment = document.createDocumentFragment();
  for (const row of state.results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `result-row ${categoryClass(row.category)}${row.id === state.activeId ? " active" : ""}`;
    button.dataset.id = row.id;
    button.innerHTML = `
      <div class="result-title">
        <span>${highlight(row.title, "title")}</span>
        <span class="badge ${categoryClass(row.category)}">${escapeHtml(row.category_label)}</span>
      </div>
      ${isEval ? `<div class="evaluation-result-scores"><strong>\u5f3a\u5ea6 ${row.strength_score ?? "\u672a\u8bc4\u4f30"}</strong><strong>\u6cdb\u7528\u6027 ${row.generality_score ?? "\u672a\u8bc4\u4f30"}</strong><span>${escapeHtml(row.status_label || "AI\u8bc4\u4f30\u00b7\u672a\u6821\u51c6")}</span></div>` : ""}
      <div class="meta">${escapeHtml(row.author_group || "")} ${escapeHtml(row.source_work || "")} \u00b7 ${escapeHtml(row.source_sheet)}!${row.source_row}</div>
      <div class="snippet">${highlight(compact(row.snippet || row.description || row.relationships || ""), state.scope)}</div>
    `;
    button.addEventListener("click", () => loadCard(row.id, true));
    fragment.append(button);
  }
  els.results.append(fragment);
}

function kv(label, value) {
  const text = String(value || "—");
  const isLong = text.length > 30 || text.includes("\n");
  const isIdentity = label === "身份";
  const className = ["kv", isLong ? "kv-long" : "", isIdentity && isLong ? "kv-wide" : ""]
    .filter(Boolean)
    .join(" ");
  const labelToScope = {
    "身份": "identity",
    "属性": "identity",
    "兵器": "weapons",
    "出处": "source_work",
    "关系": "relationships"
  };
  const fieldScope = labelToScope[label] || "all";
  return `
    <div class="${className}">
      <span>${escapeHtml(label)}</span>
      <strong>${highlight(text, fieldScope)}</strong>
    </div>
  `;
}

function abilityClass(kind, line = "") {
  if (kind === "*") return "ability-star";
  if (kind === "字") {
    return String(line || "").trimStart().startsWith("【")
      ? "ability-word ability-exclusive"
      : "ability-word";
  }
  if (["内功", "招式", "武功", "技能", "符卡"].includes(kind)) return `ability-${kind}`;
  return "ability-free";
}

function explicitAbilityKind(line) {
  const text = String(line || "").trimStart();
  const prefix = text.match(/^(?:\d+[.．、]\s*)?(内功|招式|武功|技能|符卡)：/);
  if (prefix) return prefix[1];
  if (text.startsWith("*")) return "*";
  return "";
}

function hasAbilityName(line) {
  const text = String(line || "").trimStart();
  if (explicitAbilityKind(text)) return true;
  if (/^【?[^：:\s]{1,24}】?[:：]/.test(text)) {
    return true;
  }
  return false;
}

function abilityLineMeta(line, inheritedKind = "") {
  const explicitKind = explicitAbilityKind(line);
  if (explicitKind) return { kind: explicitKind, className: abilityClass(explicitKind, line) };
  if (hasAbilityName(line)) {
    const kind = ["内功", "招式", "武功", "技能", "符卡"].includes(inheritedKind) ? inheritedKind : "字";
    return { kind, className: abilityClass(kind, line) };
  }
  if (inheritedKind) return { kind: inheritedKind, className: abilityClass(inheritedKind, line) };
  return { kind: "说明", className: "ability-free" };
}

function splitAbilityName(line) {
  const text = String(line || "");
  const heading = text.match(/^(\s*)(?:\d+[.．、]\s*)?((?:内功|招式|武功|技能|符卡)：)/);
  if (heading) {
    const typePrefix = `${heading[1]}${heading[2]}`;
    const rest = text.slice(heading[0].length);
    const name = rest.match(/^(\s*[^：:\n]{1,24}[:：])/);
    if (name) {
      return [typePrefix, name[1], rest.slice(name[1].length)];
    }
    return [typePrefix, "", rest];
  }

  const exclusive = text.match(/^(\s*【[^】]+】[:：]?)/);
  if (exclusive) {
    return ["", exclusive[1], text.slice(exclusive[1].length)];
  }

  const star = text.match(/^(\s*\*[^:：\s]{0,18}[:：]?)/);
  if (star) {
    return ["", star[1], text.slice(star[1].length)];
  }

  const name = text.match(/^(\s*[^：:\n]{1,24}[:：])/);
  if (name) {
    return ["", name[1], text.slice(name[1].length)];
  }

  return ["", "", text];
}

function renderAbilityLine(line, inheritedKind = "") {
  const meta = abilityLineMeta(line, inheritedKind);
  const [typePrefix, abilityName, rest] = splitAbilityName(line);
  if (!typePrefix && !abilityName) {
    return `<div class="ability-line ${meta.className}">${highlight(line, "ability")}</div>`;
  }
  return `
    <div class="ability-line ${meta.className}">
      ${typePrefix ? `<span class="ability-type-prefix">${highlight(typePrefix, "ability")}</span>` : ""}
      ${abilityName ? `<span class="ability-name">${highlight(abilityName, "ability")}</span>` : ""}
      ${highlight(rest, "ability")}
    </div>
  `;
}

function renderAbilityText(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return '<div class="text-block">—</div>';

  const blocks = [];
  for (const paragraph of raw.split(/\n\s*\n/).filter((block) => block.trim())) {
    let current = null;
    let inheritedKind = "";
    for (const line of paragraph.split("\n")) {
      const explicitKind = explicitAbilityKind(line);
      const lineMeta = abilityLineMeta(line, inheritedKind);
      const startsNewTypedBlock = explicitKind || current === null || lineMeta.kind !== current.kind;

      if (startsNewTypedBlock) {
        if (current && current.lines.length > 0) blocks.push(current);
        current = { kind: lineMeta.kind, className: lineMeta.className, lines: [] };
      }

      current.lines.push({ text: line, kind: lineMeta.kind });
      if (explicitKind) inheritedKind = explicitKind;
    }
    if (current && current.lines.length > 0) blocks.push(current);
  }

  return `
    <div class="ability-list">
      ${blocks
        .map((block) => {
          return `
            <div class="ability-block ${block.className}">
              <div class="ability-kind">${escapeHtml(block.kind)}</div>
              <div class="ability-content">
                ${block.lines.map((line) => renderAbilityLine(line.text, line.kind)).join("")}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function abilityBodyText(ability) {
  let text = String(ability.text || "");
  const typePrefix = String(ability.type_prefix || "");
  const rawName = String(ability.raw_name || "");
  if (typePrefix && text.startsWith(typePrefix)) {
    text = text.slice(typePrefix.length);
  }
  if (rawName && text.trimStart().startsWith(rawName)) {
    const leading = text.match(/^\s*/)?.[0] || "";
    text = leading + text.trimStart().slice(rawName.length);
  }
  text = text.replace(/^\s*[:：]\s*/, "");
  return text;
}

function renderOwnerMeta(ability) {
  const parts = [];
  if (Array.isArray(ability.owner_units) && ability.owner_units.length > 0) {
    parts.push(`所属人物：${ability.owner_units.map((name) => highlight(name)).join("、")}`);
  }
  if (ability.owner_identity) {
    parts.push(`身份：${highlight(ability.owner_identity)}`);
  }
  if (Array.isArray(ability.owner_weapons) && ability.owner_weapons.length > 0) {
    parts.push(`兵器：${ability.owner_weapons.map((name) => highlight(name)).join("、")}`);
  }
  if (parts.length === 0) return "";
  return `<span class="ability-owner">${parts.join("；")}</span>`;
}

function renderAbilityRecords(abilities, fallbackText, options = {}) {
  if (!Array.isArray(abilities) || abilities.length === 0) {
    return renderAbilityText(fallbackText || "");
  }
  const showOwnerMeta = options.showOwnerMeta !== false;

  return `
    <div class="ability-list">
      ${abilities
        .map((ability) => {
          const kind = ability.kind || "说明";
          const className = abilityClass(kind, ability.raw_name || ability.name || "");
          
          const isExclusive = abilityIsExclusive(ability);
          const isIdentity = abilityIsIdentity(ability);
          
          const exclusiveBadge = isExclusive ? `<span class="ability-badge exclusive">专属</span>` : "";
          const identityBadge = isIdentity ? `<span class="ability-badge identity" title="身份特技：结算时序不受“看不见”和“禁制”影响，但会被“混”克制。">身份</span>` : "";
          const badgesHtml = `${exclusiveBadge}${identityBadge}`;

          const name = ability.name ? `<span class="ability-name">${highlight(ability.name, "ability:" + kind)}${ability.name.endsWith("：") ? "" : "："}</span>` : "";
          const body = abilityBodyText(ability);
          const flags = Array.isArray(ability.review_flags) && ability.review_flags.length
            ? `<div class="ability-flags">${ability.review_flags.map((flag) => escapeHtml(flag)).join(" · ")}</div>`
            : "";
          return `
            <div class="ability-block ${className}">
              <div class="ability-kind">${escapeHtml(kind)}${badgesHtml}</div>
              <div class="ability-content">
                <div class="ability-line">${name}${highlight(body, "ability:" + kind)}${showOwnerMeta ? renderOwnerMeta(ability) : ""}</div>
                ${flags}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderUnitMeta(unit) {
  const items = [];
  if (unit.life) items.push(kv("生命", unit.life));
  if (unit.life_pool) items.push(kv("共享生命", unit.life_pool));
  if (unit.gender) items.push(kv("性别", unit.gender));
  if (unit.counts_as_characters) items.push(kv("计人数", unit.counts_as_characters));
  if (unit.entity_kind) items.push(kv("属性", unit.entity_kind));
  if (unit.identity) items.push(kv("身份", unit.identity));
  if (Array.isArray(unit.weapons) && unit.weapons.length > 0) items.push(kv("兵器", unit.weapons.join("、")));
  if (unit.relationships) items.push(kv("关系", unit.relationships));
  if (unit.note) items.push(kv("备注", unit.note));
  if (items.length === 0) return "";
  return `<div class="unit-meta">${items.join("")}</div>`;
}

function renderUnitGroups(card) {
  if (!Array.isArray(card.units) || card.units.length === 0) {
    return renderAbilityRecords(card.abilities, card.description || "");
  }

  const isAllUnitsGroup = (unit) => unit.name === "__all_units__";
  const hasSharedAbilities = card.units.some((unit) => {
    const abilities = Array.isArray(unit.abilities) ? unit.abilities : [];
    return isAllUnitsGroup(unit) && abilities.length > 0;
  });

  return `
    <div class="unit-list">
      ${card.units
        .map((unit) => {
          const displayName = unit.display_name || (isAllUnitsGroup(unit) ? "共同特技" : unit.name);
          const abilities = Array.isArray(unit.abilities) ? unit.abilities : [];
          const isShared = isAllUnitsGroup(unit) || unit.is_ability_group;
          const headerLabel = abilities.length > 0
            ? `${abilities.length} ${isShared ? "条共同特技" : "条特技"}`
            : "人物单元";
          const emptyText = hasSharedAbilities && !isShared ? "" : '<div class="text-block unit-empty">无特技</div>';
          return `
            <section class="unit-block">
              <div class="unit-header">
                <h4>${highlight(displayName)}</h4>
                <span>${headerLabel}</span>
              </div>
              ${renderUnitMeta(unit)}
              ${abilities.length > 0
                ? renderAbilityRecords(abilities, "", { showOwnerMeta: false })
                : emptyText}
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderIdentityRules(card) {
  const identity = String(card.identity || "").trim();
  if (!identity) return "";
  return `
    <div class="section identity-section">
      <h3>身份</h3>
      <div class="identity-rule-block">${highlight(identity)}</div>
    </div>
  `;
}

function renderListItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<ul class="note-list">${items.map((item) => `<li>${highlight(item)}</li>`).join("")}</ul>`;
}

function renderReviewField(label, value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return `
      <div class="review-field">
        <span>${escapeHtml(label)}</span>
        ${renderListItems(value)}
      </div>
    `;
  }
  if (typeof value === "object") {
    const rows = Object.entries(value).filter(([, item]) => {
      if (item == null || item === "") return false;
      if (Array.isArray(item)) return item.length > 0;
      return true;
    });
    if (rows.length === 0) return "";
    return `
      <div class="review-field">
        <span>${escapeHtml(label)}</span>
        <div class="review-grid">
          ${rows.map(([key, item]) => kv(key, Array.isArray(item) ? item.join("、") : item)).join("")}
        </div>
      </div>
    `;
  }
  return `
    <div class="review-field">
      <span>${escapeHtml(label)}</span>
      <div class="text-block">${highlight(value)}</div>
    </div>
  `;
}

function renderReviewLayer(review) {
  if (!review || Object.keys(review).length === 0) return "";
  const content = [
    renderReviewField("作者裁定", review.author_rulings),
    renderReviewField("设计备注", review.design_notes),
    renderReviewField("AI评语", review.ai_review),
    renderReviewField("标签", review.tags),
    renderReviewField("强度", review.strength),
    renderReviewField("风险", review.risks),
    renderReviewField("攻略", review.play_tips),
  ].filter(Boolean).join("");
  if (!content) return "";
  return `
    <div class="section review-section">
      <h3>评语/裁定</h3>
      ${content}
    </div>
  `;
}

// setSearchMode is a legacy stub; mode switching now handled by tab architecture
function setSearchMode(mode) {
  state.searchMode = mode === "evaluations" ? "evaluations" : "cards";
}


function reviewStatusLabel(status) {
  if (status === "author_confirmed") return "作者已确认";
  if (status === "author_reviewed") return "作者评估";
  if (status === "ai_draft") return "ai草稿";
  if (status === "ai_unreviewed") return "ai评估";
  if (status === "unreviewed") return "未评估";
  return status || "未标状态";
}

function renderEvaluationMethodology(methodology) {
  if (!methodology || typeof methodology !== "object") return "";
  const ranges = Array.isArray(methodology.score_ranges) ? methodology.score_ranges : [];
  return `
    <details class="review-details methodology-details">
      <summary>查看评价标准与分数区间</summary>
      ${renderReviewField("不同类别评价标准", methodology.category_standards)}
      ${renderReviewField("分数区间", ranges.map((item) => `${item.range}：${item.meaning}`))}
    </details>
  `;
}

function renderEvaluationSummary(summary) {
  if (!summary || typeof summary !== "object") return "";
  const survival = summary.survival && typeof summary.survival === "object" ? summary.survival : {};
  const front = survival.front && typeof survival.front === "object" ? survival.front : {};
  const side = survival.side && typeof survival.side === "object" ? survival.side : {};
  const risks = summary.risks && typeof summary.risks === "object" ? summary.risks : {};
  const questions = Array.isArray(summary.questions) ? summary.questions : [];
  const missing = Array.isArray(summary.missing_fields) ? summary.missing_fields : [];
  const survivalCard = (label, item) => `
    <div class="evaluation-summary-card">
      <div class="evaluation-summary-label">${escapeHtml(label)}${item.score != null ? ` · ${escapeHtml(item.score)}` : " · 未评分"}</div>
      <div class="text-block">${highlight(item.summary || "旧批次未单列此项。")}</div>
    </div>
  `;
  return `
    <div class="evaluation-summary">
      ${summary.core_positioning ? renderReviewField("核心定位", summary.core_positioning) : ""}
      ${summary.overall ? renderReviewField("一句话总评", summary.overall) : ""}
      <div class="evaluation-survival-grid">
        ${survivalCard("正面生存", front)}
        ${survivalCard("侧面生存", side)}
      </div>
      <div class="evaluation-procon-grid">
        <div>${renderReviewField("优点", summary.pros && summary.pros.length ? summary.pros : ["旧批次未单列。"] )}</div>
        <div>${renderReviewField("缺点", summary.cons && summary.cons.length ? summary.cons : ["旧批次未单列。"] )}</div>
      </div>
      ${renderReviewField("待作者校准问题", questions.length
        ? questions.map((item) => `${item.question}${item.impact ? `（影响：${item.impact}）` : ""}`)
        : ["当前结构化摘要中没有开放问题。"])}
      <div class="evaluation-risk-grid">
        <div>${renderReviewField(`规则风险${risks.rules?.level ? ` · ${risks.rules.level}` : ""}`, risks.rules?.summary || "旧批次未单列。")}</div>
        <div>${renderReviewField(`电子化风险${risks.digital?.level ? ` · ${risks.digital.level}` : ""}`, risks.digital?.summary || "旧批次未单列。")}</div>
      </div>
      ${missing.length ? `<div class="review-source-note">兼容旧结构：缺失栏目保持未评估，没有自动补写。缺失：${escapeHtml(missing.join("、"))}</div>` : ""}
    </div>
  `;
}

function renderEvaluationLayer(evaluation) {
  const data = evaluation && typeof evaluation === "object"
    ? evaluation
    : { status: "unreviewed", status_label: "未评估", entries: [] };
  const status = data.status || "unreviewed";
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const entryHtml = entries.map((entry) => `
    <article class="evaluation-entry">
      <div class="evaluation-score-row">
        <strong>${escapeHtml(entry.display_title || entry.card_title || "评审条目")}</strong>
        <span>强度 ${entry.strength_score != null ? escapeHtml(entry.strength_score) : "未评估"}</span>
        <span>泛用性 ${entry.generality_score != null ? escapeHtml(entry.generality_score) : "未评估"}</span>
      </div>
      <div class="review-source-note">
        Batch ${escapeHtml(entry.batch)} · ${escapeHtml(entry.category_label || "未识别类别")} · ${escapeHtml(entry.status_label || "AI评估·未校准")}
      </div>
      ${renderEvaluationSummary(entry.summary)}
      <details class="review-details evaluation-full-text">
        <summary>查看完整评审正文（未压缩）</summary>
        <div class="text-block">${highlight(entry.full_text || "")}</div>
        <div class="review-source-note">来源：${escapeHtml(entry.source_path || "二级评价库")}</div>
      </details>
    </article>
  `).join("");
  const empty = entries.length ? "" : `<div class="evaluation-empty">这张卡尚无评价信息。</div>`;
  return `
    <div class="section evaluation-section">
      <div class="review-heading">
        <h3>评审与理解</h3>
        <span class="review-status ${escapeHtml(status)}">${escapeHtml(data.status_label || reviewStatusLabel(status))}</span>
      </div>
      <div class="review-source-note">二级评价数据，不是牌面源数据。AI评分未经作者校准时仅供参考。</div>
      ${entryHtml || empty}
      ${renderEvaluationMethodology(state.evaluationMethodology)}
    </div>
  `;
}

function renderUnderstandingLayer(note) {
  if (!note || Object.keys(note).length === 0) return "";
  const status = note.status || "ai_draft";
  const hasAuthorRulings = Array.isArray(note.author_rulings) && note.author_rulings.length > 0;
  const summary = [
    renderReviewField("核心定位", note.core_positioning),
    renderReviewField("实战价值", note.practical_value),
    renderReviewField("泛用性", note.generality),
  ].filter(Boolean).join("");
  const extra = [
    renderReviewField("作者裁定", hasAuthorRulings ? note.author_rulings : ["暂无作者校准。"]),
    renderReviewField("关键机制", note.key_mechanics),
    renderReviewField("玩法提示", note.strategy_notes),
    renderReviewField("规则风险", note.rules_risks),
    renderReviewField("AI易误判", note.ai_misread_risks),
    renderReviewField("待校准问题", note.needs_author_review),
    renderReviewField("艺术形象参考", note.flavor_alignment),
    renderReviewField("资料/来源说明", note.source_research),
  ].filter(Boolean).join("");
  const content = `${summary}${extra ? `<details class="review-details"><summary>更多评审信息</summary>${extra}</details>` : ""}`;
  if (!content) return "";
  return `
    <div class="section understanding-section">
      <div class="review-heading">
        <h3>评审与理解</h3>
        <span class="review-status ${escapeHtml(status)}">${escapeHtml(reviewStatusLabel(status))}</span>
      </div>
      <div class="review-source-note">这是评语层内容，不是牌面源数据。${hasAuthorRulings ? "有作者校准内容。" : "暂无作者校准。"}</div>
      ${content}
    </div>
  `;
}

function maintenanceKindLabel(kind) {
  if (kind === "card_face_todo") return "卡面排版";
  if (kind === "card_text_audit") return "文案审计";
  return kind || "维护待办";
}

function renderMaintenanceTodos(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `
    <div class="section maintenance-section">
      <div class="review-heading">
        <h3>整理/修订待办</h3>
        <span class="review-status todo-status">${items.length} 项</span>
      </div>
      <div class="review-source-note">来自 reports 的维护层提示，不是牌面源数据，也不是强度评价。</div>
      <details class="review-details">
        <summary>查看待办项</summary>
        <div class="maintenance-list">
          ${items.map((item) => `
            <div class="maintenance-item">
              <div class="maintenance-item-head">
                <span>${escapeHtml(maintenanceKindLabel(item.kind))}</span>
                <small>${escapeHtml(item.section || item.source_report || "")}</small>
              </div>
              <div class="maintenance-summary">${highlight(item.summary || item.subject || "待整理")}</div>
              ${renderListItems(item.details)}
            </div>
          `).join("")}
        </div>
      </details>
    </div>
  `;
}

function renderStructureNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return "";
  return `
    <div class="section structure-section">
      <h3>结构说明</h3>
      <div class="structure-list">
        ${notes.map((note) => {
          const groups = Array.isArray(note.groups) && note.groups.length
            ? `<div class="structure-groups">
                ${note.groups.map((group) => `
                  <div class="structure-group">
                    <strong>${highlight(group.name || "")}</strong>
                    <span>${Array.isArray(group.applies_to) ? group.applies_to.map((item) => highlight(item)).join("、") : ""}</span>
                  </div>
                `).join("")}
              </div>`
            : "";
          return `
            <article class="structure-note">
              <div class="structure-note-title">
                <strong>${highlight(note.title || "结构说明")}</strong>
                <span>${escapeHtml(note.kind || "说明")}</span>
              </div>
              <div class="text-block">${highlight(note.text || "")}</div>
              ${groups}
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function documentMetaLine(document) {
  const parts = [];
  if (document.kind) parts.push(String(document.kind).toUpperCase());
  if (document.size) parts.push(`${Math.round(Number(document.size) / 1024)} KB`);
  return parts.join(" \u00b7 ");
}

function documentVersionLine(doc) {
  const parts = [];
  if (doc.version) parts.push(doc.version);
  if (doc.updated) parts.push(`\u66f4\u65b0\uff1a${doc.updated}`);
  return parts.join(" \u00b7 ");
}

function libraryVersionLine() {
  const meta = state.documentMeta || {};
  const parts = [];
  if (meta.library_version) parts.push(`\u8d44\u6599\u5e93 v${meta.library_version}`);
  if (meta.site_version) parts.push(`\u7f51\u9875 v${meta.site_version}`);
  if (meta.updated) parts.push(`\u66f4\u65b0\uff1a${meta.updated}`);
  return parts.join(" \u00b7 ");
}

function highlightTerm(value, term) {
  const text = escapeHtml(value ?? "");
  const q = String(term || "").trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), (match) => `<mark>${match}</mark>`);
}

function countTerm(value, term) {
  const text = String(value || "").toLowerCase();
  const q = String(term || "").trim().toLowerCase();
  if (!q) return 0;
  return text.split(q).length - 1;
}

function documentTextForSearch(doc) {
  const sections = Array.isArray(doc.sections) ? doc.sections : [];
  if (sections.length) {
    return sections.map((section) => `${section.title || ""}\n${section.content || ""}`).join("\n\n");
  }
  return String(doc.content || "");
}

function renderDocumentText(content, query = "") {
  const raw = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  const blocks = raw.split(/\n{2,}/).filter((block) => block.trim());
  return `
    <div class="document-text">
      ${blocks.map((block) => {
        const text = block.trim();
        if (/^#{1,4}\s+/.test(text)) {
          const level = Math.min((text.match(/^#+/) || [""])[0].length + 3, 6);
          return `<h${level}>${highlightTerm(text.replace(/^#{1,4}\s+/, ""), query)}</h${level}>`;
        }
        if (/^[-*]\s+/.test(text)) {
          const items = text.split("\n").map((line) => line.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
          return `<ul>${items.map((item) => `<li>${highlightTerm(item, query)}</li>`).join("")}</ul>`;
        }
        return `<p>${highlightTerm(text, query)}</p>`;
      }).join("")}
    </div>
  `;
}

function isScenarioDocument(doc) {
  return doc && (doc.id === "scenario-book" || String(doc.title || "").includes("\u5267\u672c"));
}

function isScenarioCharacterLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;
  if (/[:\uff1a]/.test(text)) return false;
  if (/^[\uff08(]/.test(text)) return false;
  if (/^(?:\u5185\u529f|\u62db\u5f0f|\u6b66\u529f|\u6280\u80fd)/.test(text)) return false;
  if (/^(?:\u9635\u8425|\u5267\u672c|\u80dc\u5229|\u5982|\u82e5|\u5982\u679c|\u7531|\u540c|\u5176\u4f59|\u4e0a\u5c40|\u672c\u6765|\u5bf9\u9635)/.test(text)) return false;
  if (/^(?:\u751f\u547d|\u6bd2\u7c7b|\u626e\u6f14|\u9644\u52a0|\u6301\u6709)/.test(text)) return false;

  const hasLife = /^[\u4e00-\u9fffA-Za-z0-9\u00b7\u3001\uff08\uff09() ]{2,32}\s+\d+(?:\*\d+)?(?:\s|$)/.test(text);
  const plainName = /^[\u4e00-\u9fff\u00b7]{2,7}$/.test(text) && !/[\u65e0\u4e0d\u53ef\u5219\u4e0e\u7531\u4e3a\u5982\u540c\u4e0a\u4e0b\u751f\u547d\u653b\u51fb\u4f24\u5bb3]/.test(text);
  return hasLife || plainName;
}

function splitScenarioAbility(line, inheritedKind = "") {
  const text = String(line || "").trim();
  const typed = text.match(/^(\u5185\u529f|\u62db\u5f0f|\u6b66\u529f|\u6280\u80fd)\s*[:\uff1a]\s*(.*)$/);
  if (typed) {
    const rest = typed[2].trim();
    const named = rest.match(/^([^:\uff1a]{1,38})\s*[:\uff1a]\s*(.*)$/);
    return {
      kind: typed[1],
      name: named ? named[1].trim() : "",
      text: named ? named[2].trim() : rest,
      groupHeader: !rest
    };
  }

  const star = text.match(/^\*\s*(.*)$/);
  if (star) {
    const rest = star[1].trim();
    const named = rest.match(/^([^:\uff1a]{1,38})\s*[:\uff1a]\s*(.*)$/);
    return {
      kind: "*",
      name: named ? named[1].trim() : "",
      text: named ? named[2].trim() : rest
    };
  }

  const named = text.match(/^([^:\uff1a]{1,38})\s*[:\uff1a]\s*(.*)$/);
  if (named) {
    return { kind: inheritedKind || "\u5b57", name: named[1].trim(), text: named[2].trim() };
  }
  return null;
}

function renderScenarioAbility(line, query = "", inheritedKind = "") {
  const ability = splitScenarioAbility(line, inheritedKind);
  if (!ability) return "";
  const kind = ability.kind ? `<span class="scenario-kind">${escapeHtml(ability.kind)}</span>` : "";
  const name = ability.name ? `<strong class="scenario-ability-name">${highlightTerm(ability.name, query)}</strong>` : "";
  const body = ability.text ? `<span class="scenario-ability-text">${highlightTerm(ability.text, query)}</span>` : "";
  const groupClass = ability.groupHeader ? " scenario-ability-group" : "";
  return `<div class="scenario-ability${groupClass}">${kind}${name}${body}</div>`;
}

function renderScenarioText(content, query = "") {
  const raw = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  const blocks = raw.split(/\n{2,}/).filter((block) => block.trim());
  let html = '<div class="document-text scenario-text">';
  let characterOpen = false;
  let currentKind = "";

  const closeCharacter = () => {
    if (characterOpen) {
      html += "</article>";
      characterOpen = false;
    }
  };

  blocks.forEach((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    lines.forEach((line) => {
      if (isScenarioCharacterLine(line)) {
        closeCharacter();
        currentKind = "";
        html += `<article class="scenario-character"><h4>${highlightTerm(line, query)}</h4>`;
        characterOpen = true;
        return;
      }

      const ability = splitScenarioAbility(line, currentKind);
      if (ability) {
        if (ability.kind && ability.kind !== "\u5b57") currentKind = ability.kind;
        if (!characterOpen) html += '<div class="scenario-prose">';
        html += renderScenarioAbility(line, query, currentKind);
        if (!characterOpen) html += "</div>";
        return;
      }

      const noteClass = /^(?:\u5982\u626e\u6f14|\u82e5\u626e\u6f14|\u5982\u679c|\u80dc\u5229\u6761\u4ef6|\u9635\u8425|\u7531|vs|VS)/.test(line)
        ? " scenario-note"
        : "";
      const paragraph = `<p class="scenario-line${noteClass}">${highlightTerm(line, query)}</p>`;
      if (characterOpen) html += paragraph;
      else html += `<div class="scenario-prose">${paragraph}</div>`;
    });
  });

  closeCharacter();
  html += "</div>";
  return html;
}

function documentSectionDomId(section, index) {
  return `document-section-${escapeHtml(section.id || String(index + 1))}`;
}

function renderDocumentSections(doc, query = "") {
  const sections = Array.isArray(doc.sections) ? doc.sections.filter((section) => section && (section.title || section.content)) : [];
  const renderBody = (content) => isScenarioDocument(doc) ? renderScenarioText(content, query) : renderDocumentText(content, query);
  if (sections.length <= 1) return renderBody(doc.content) || '<div class="text-block">\u6682\u65e0\u53ef\u8bfb\u53d6\u6b63\u6587\u3002</div>';
  return `
    <div class="document-reader">
      <nav class="document-toc" aria-label="\u6587\u6863\u76ee\u5f55">
        <div class="document-toc-title">\u76ee\u5f55</div>
        ${sections.map((section, index) => `
          <button class="document-toc-item level-${Math.min(Number(section.level || 2), 4)}" type="button" data-section-target="${documentSectionDomId(section, index)}" title="${escapeHtml(section.title || `\u7ae0\u8282 ${index + 1}`)}">
            ${highlightTerm(section.title || `\u7ae0\u8282 ${index + 1}`, query)}
          </button>
        `).join("")}
      </nav>
      <div class="document-section-list">
        ${sections.map((section, index) => `
          <article class="document-chapter" id="${documentSectionDomId(section, index)}">
            <h3>${highlightTerm(section.title || `\u7ae0\u8282 ${index + 1}`, query)}</h3>
            ${section.content ? renderBody(section.content) : ""}
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function bindDocumentDetailEvents() {
  els.detail.querySelector("#documentBackButton")?.addEventListener("click", () => showDocuments(state.documentListQuery || ""));
  const searchInput = els.detail.querySelector("#documentCurrentSearchInput");
  const runCurrentSearch = () => renderDocumentDetail(state.currentDocument, searchInput.value.trim());
  els.detail.querySelector("#documentCurrentSearchButton")?.addEventListener("click", runCurrentSearch);
  els.detail.querySelector("#documentCurrentClearButton")?.addEventListener("click", () => renderDocumentDetail(state.currentDocument, ""));
  els.detail.querySelector("#documentPrevMatchButton")?.addEventListener("click", () => jumpDocumentMatch(-1));
  els.detail.querySelector("#documentNextMatchButton")?.addEventListener("click", () => jumpDocumentMatch(1));
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runCurrentSearch();
  });
  els.detail.querySelectorAll("[data-section-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.sectionTarget);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

}

function documentMatches() {
  return Array.from(els.detail.querySelectorAll(".document-section-list mark"));
}

function updateDocumentMatchStatus() {
  const matches = documentMatches();
  if (!matches.length) {
    state.currentDocumentMatchIndex = -1;
  } else if (state.currentDocumentMatchIndex < 0 || state.currentDocumentMatchIndex >= matches.length) {
    state.currentDocumentMatchIndex = 0;
  }
  matches.forEach((mark, index) => {
    mark.classList.toggle("active-match", index === state.currentDocumentMatchIndex);
  });
  const status = els.detail.querySelector("#documentMatchStatus");
  if (status) {
    status.textContent = matches.length ? `${state.currentDocumentMatchIndex + 1} / ${matches.length}` : "";
  }
  const prev = els.detail.querySelector("#documentPrevMatchButton");
  const next = els.detail.querySelector("#documentNextMatchButton");
  if (prev) prev.disabled = matches.length === 0;
  if (next) next.disabled = matches.length === 0;
}

function jumpDocumentMatch(delta = 0) {
  const matches = documentMatches();
  if (!matches.length) {
    updateDocumentMatchStatus();
    return;
  }
  state.currentDocumentMatchIndex = (state.currentDocumentMatchIndex + delta + matches.length) % matches.length;
  updateDocumentMatchStatus();
  matches[state.currentDocumentMatchIndex].scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderDocumentDetail(doc, query = "") {
  if (!doc) return;
  state.currentDocument = doc;
  state.currentDocumentQuery = query;
  state.currentDocumentMatchIndex = query ? 0 : -1;
  const matchCount = countTerm(documentTextForSearch(doc), query);
  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");
  els.detail.innerHTML = `
    <div class="document-toolbar">
      <button id="documentBackButton" type="button">\u8fd4\u56de\u8d44\u6599\u5e93</button>
      <span>${escapeHtml(libraryVersionLine())}</span>
    </div>
    <div class="document-titlebar">
      <div>
        <h2>${highlightTerm(doc.title, query)}</h2>
        <p>${escapeHtml(documentVersionLine(doc))}</p>
      </div>
      <span class="badge">${escapeHtml(doc.group || "\u8d44\u6599")}</span>
    </div>
    <div class="document-current-search">
      <input id="documentCurrentSearchInput" type="search" value="${escapeHtml(query)}" placeholder="\u5728\u5f53\u524d\u6587\u6863\u4e2d\u641c\u7d22" autocomplete="off" />
      <button id="documentCurrentSearchButton" type="button">\u641c\u672c\u6587</button>
      <button id="documentCurrentClearButton" type="button">\u6e05\u9664</button>
      <button id="documentPrevMatchButton" type="button" ${query && matchCount ? "" : "disabled"}>\u4e0a\u4e00\u5904</button>
      <button id="documentNextMatchButton" type="button" ${query && matchCount ? "" : "disabled"}>\u4e0b\u4e00\u5904</button>
      <span id="documentMatchStatus">${query && matchCount ? `1 / ${matchCount}` : ""}</span>
    </div>
    ${doc.description ? `<div class="document-intro">${highlightTerm(doc.description, query)}</div>` : ""}
    <div class="document-section">
      ${renderDocumentSections(doc, query)}
    </div>
  `;
  bindDocumentDetailEvents();
  if (query) window.setTimeout(() => jumpDocumentMatch(0), 0);
}

async function loadDocument(id) {
  setDocumentMode(true);
  els.detail.innerHTML = `<div class="empty-state">\u8bfb\u53d6\u6587\u6863\u4e2d...</div>`;
  const doc = await getJson(`/api/document/${encodeURIComponent(id)}`);
  state.activeId = `document:${id}`;
  renderDocumentDetail(doc, "");
  setMobileActivePage("detail");
}

function renderDocumentHome(documents, searchText = "") {
  const grouped = documents.reduce((acc, doc) => {
    const group = doc.group || "\u8d44\u6599";
    if (!acc[group]) acc[group] = [];
    acc[group].push(doc);
    return acc;
  }, {});

  els.detail.innerHTML = `
    <div class="document-home">
      <div class="document-titlebar">
        <div>
          <h2>\u8d44\u6599\u5e93</h2>
          <p>${escapeHtml(libraryVersionLine())}</p>
        </div>
        <span class="badge">\u89c4\u5219/\u5267\u672c</span>
      </div>
      <div class="document-search">
        <input id="documentSearchInput" type="search" value="${escapeHtml(searchText)}" placeholder="\u641c\u7d22\u89c4\u5219\u4e66\u3001\u5267\u672c\u6b63\u6587" autocomplete="off" />
        <button id="documentSearchButton" type="button">\u641c\u7d22</button>
        <button id="documentClearButton" type="button">\u5168\u90e8\u8d44\u6599</button>
      </div>
      ${searchText ? `<div class="document-search-summary">\u641c\u7d22\u201c${highlightTerm(searchText, searchText)}\u201d\uff0c\u627e\u5230 ${documents.length} \u9879\u8d44\u6599\u3002</div>` : ""}
      <div class="resource-grid">
        ${Object.entries(grouped).map(([group, items]) => `
          <section class="resource-group">
            <h3>${escapeHtml(group)}</h3>
            ${items.map((doc) => `
              <button class="resource-card" type="button" data-document-id="${escapeHtml(doc.id)}">
                <strong>${highlightTerm(doc.title, searchText)}</strong>
                ${documentVersionLine(doc) ? `<small>${escapeHtml(documentVersionLine(doc))}</small>` : ""}
                <span>${highlightTerm((doc.snippets && doc.snippets.length ? doc.snippets.join(" ") : doc.description || doc.path || ""), searchText)}</span>
                <em>${escapeHtml(documentMetaLine(doc))}</em>
              </button>
            `).join("")}
          </section>
        `).join("")}
      </div>
    </div>
  `;
  els.detail.querySelectorAll("[data-document-id]").forEach((button) => {
    button.addEventListener("click", () => loadDocument(button.dataset.documentId));
  });
  const searchInput = els.detail.querySelector("#documentSearchInput");
  const runDocumentSearch = () => showDocuments(searchInput.value.trim());
  els.detail.querySelector("#documentSearchButton").addEventListener("click", runDocumentSearch);
  els.detail.querySelector("#documentClearButton").addEventListener("click", () => showDocuments(""));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runDocumentSearch();
  });
}

function renderDocsSidebarList(documents) {
  if (!els.docsSidebarList) return;
  els.docsSidebarList.innerHTML = documents.map(doc => `
    <button class="docs-sidebar-item ${state.activeId === 'document:' + doc.id ? 'active' : ''}" type="button" data-sidebar-doc-id="${escapeHtml(doc.id)}">
      <strong>${escapeHtml(doc.title)}</strong>
      ${doc.version ? `<small>版本：${escapeHtml(doc.version)}</small>` : ""}
    </button>
  `).join("");
  
  els.docsSidebarList.querySelectorAll("[data-sidebar-doc-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      els.docsSidebarList.querySelectorAll(".docs-sidebar-item").forEach(item => item.classList.remove("active"));
      btn.classList.add("active");
      loadDocument(btn.dataset.sidebarDocId);
    });
  });
}

async function showDocuments(searchText = "") {
  setDocumentMode(true);
  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");
  els.count.textContent = "";
  els.results.innerHTML = "";
  els.detail.innerHTML = `<div class="empty-state">读取资料中...</div>`;
  try {
    searchText = typeof searchText === "string" ? searchText : "";
    state.documentListQuery = searchText;
    state.query = searchText;
    state.currentDocument = null;
    state.currentDocumentQuery = "";
    const data = searchText
      ? await getJson(`/api/document-search?${new URLSearchParams({ q: searchText }).toString()}`)
      : await getJson("/api/documents");
    if (!searchText) {
      state.documentMeta = {
        library_version: data.library_version,
        site_version: data.site_version,
        updated: data.updated,
      };
    }
    const documents = Array.isArray(data.results) ? data.results : (Array.isArray(data.documents) ? data.documents : []);
    els.count.textContent = `${documents.length} 项`;
    renderDocumentHome(documents, searchText);
    renderDocsSidebarList(documents);
  } catch (error) {
    console.error(error);
    els.count.textContent = "资料读取失败";
    const message = escapeHtml(error.message || String(error));
    els.detail.innerHTML = `<div class="empty-state">资料读取失败：${message}</div>`;
  }
}

const SOURCE_WORK_TO_AUTHOR = {
  // 古龙
  "圆月弯刀": "古龙", "英雄无泪": "古龙", "萧十一郎": "古龙", "武林外史": "古龙", "天涯明月刀": "古龙",
  "三少爷的剑": "古龙", "拳头": "古龙", "情人箭": "古龙", "七武器": "古龙", "七杀手": "古龙",
  "名剑风流": "古龙", "陆小凤传奇": "古龙", "流星蝴蝶剑": "古龙", "绝代双骄": "古龙", "九月鹰飞": "古龙",
  "剑玄录": "古龙", "浣花洗剑录": "古龙", "欢乐英雄": "古龙", "孤星传": "古龙", "飞刀又见飞刀": "古龙",
  "多情剑客无情剑": "古龙", "大旗英雄传": "古龙", "大地飞鹰": "古龙", "楚留香传奇": "古龙", "碧玉刀": "古龙",
  "白玉老虎": "古龙", "霸王枪": "古龙", "血鹦鹉": "古龙",
  // 黄易
  "寻秦记": "黄易", "日月当空": "黄易", "破碎虚空": "黄易", "凌渡宇系列": "黄易", "覆雨翻云": "黄易",
  "大唐双龙传": "黄易", "边荒传说": "黄易",
  // 金庸
  "越女剑": "金庸", "鸳鸯刀": "金庸", "倚天屠龙记": "金庸", "雪山飞狐": "金庸", "笑傲江湖": "金庸",
  "侠客行": "金庸", "天龙八部": "金庸", "书剑恩仇录": "金庸", "神雕侠侣": "金庸", "射雕英雄传": "金庸",
  "鹿鼎记": "金庸", "连城诀": "金庸", "飞狐外传": "金庸", "碧血剑": "金庸", "白马啸西风": "金庸",
  // 老舍
  "断魂枪": "老舍",
  // 李凉
  "杨小邪": "李凉",
  // 梁羽生
  "云海玉弓缘": "梁羽生", "萍踪侠影录": "梁羽生",
  // 鲁迅
  "铸剑": "鲁迅",
  // 温瑞安
  "血河车": "温瑞安", "四大名捕": "温瑞安", "说英雄谁是英雄": "温瑞安", "神州奇侠": "温瑞安", "杀人者唐斩": "温瑞安",
  "请借夫人一用": "温瑞安", "七大寇": "温瑞安", "逆水寒": "温瑞安", "大侠传奇": "温瑞安", "布衣神相": "温瑞安",
  "白衣方振眉": "温瑞安",
};

function setMobileActivePage(page) {
  state.mobileActivePage = page;
  document.body.classList.remove("active-page-filter", "active-page-list", "active-page-detail");
  document.body.classList.add(`active-page-${page}`);

  // 联动底部按钮高亮
  els.mTabFilter?.classList.toggle("active", page === "filter");
  els.mTabList?.classList.toggle("active", page === "list");
  els.mTabDetail?.classList.toggle("active", page === "detail");
}

function sortCounter(counterEntries, type) {
  if (state.statSortMode === "count") {
    return counterEntries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans"));
  }
  
  const categoryOrder = ["战斗人物", "附加人物", "物品", "称号", "场景", "废弃记录", "未标"];
  const abilityOrder = ["内功", "招式", "武功", "技能", "*", "字", "说明", "符卡", "未标"];
  const authorOrder = ["金庸", "古龙", "梁羽生", "温瑞安", "黄易", "李凉", "鲁迅", "老舍", "其他", "未标"];
  const jinyongWorksOrder = [
    "飞狐外传", "雪山飞狐", "连城诀", "天龙八部", "射雕英雄传",
    "白马啸西风", "鹿鼎记", "笑傲江湖", "书剑恩仇录", "神雕侠侣",
    "侠客行", "倚天屠龙记", "碧血剑", "鸳鸯刀", "越女剑"
  ];
  
  const getOrderIndex = (list, item) => {
    const idx = list.indexOf(item);
    return idx === -1 ? 9999 : idx;
  };
  
  if (type === "category") {
    return counterEntries.sort((a, b) => getOrderIndex(categoryOrder, a[0]) - getOrderIndex(categoryOrder, b[0]));
  }
  if (type === "ability") {
    return counterEntries.sort((a, b) => getOrderIndex(abilityOrder, a[0]) - getOrderIndex(abilityOrder, b[0]));
  }
  if (type === "author") {
    return counterEntries.sort((a, b) => getOrderIndex(authorOrder, a[0]) - getOrderIndex(authorOrder, b[0]));
  }
  if (type === "source_work") {
    return counterEntries.sort((a, b) => {
      const authorA = SOURCE_WORK_TO_AUTHOR[a[0]] || "其他";
      const authorB = SOURCE_WORK_TO_AUTHOR[b[0]] || "其他";
      const idxA = getOrderIndex(authorOrder, authorA);
      const idxB = getOrderIndex(authorOrder, authorB);
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      if (authorA === "金庸") {
        return getOrderIndex(jinyongWorksOrder, a[0]) - getOrderIndex(jinyongWorksOrder, b[0]);
      }
      return a[0].localeCompare(b[0], "zh-Hans");
    });
  }
  
  return counterEntries;
}

function counterList(sortedEntries, limit = 100) {
  if (!Array.isArray(sortedEntries)) return "";
  return sortedEntries
    .slice(0, limit)
    .map(([key, value]) => `<li><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></li>`)
    .join("");
}

window.setCardViewMode = function(mode) {
  state.cardDisplayMode = mode;
  if (mode === "stats") {
    state.activeId = null;
    renderResults();
    showCardSearchStatistics();
    setMobileActivePage("detail");
  } else {
    if (state.results.length > 0) {
      loadCard(state.results[0].id);
    } else {
      els.detail.innerHTML = `
        <div class="detail-view-tabs">
          <button class="view-tab-btn active" onclick="window.setCardViewMode('detail')">📄 单卡详情</button>
          <button class="view-tab-btn" onclick="window.setCardViewMode('stats')">📊 汇总统计</button>
        </div>
        <div class="empty-state">当前结果列表为空，没有可展示详情的卡牌</div>
      `;
      setMobileActivePage("detail");
    }
  }
};

window.setEvalViewMode = function(mode) {
  state.evalDisplayMode = mode;
  if (mode === "stats") {
    els.evalListModeBtn?.classList.remove("active");
    els.evalStatsModeBtn?.classList.add("active");
    state.activeId = null;
    renderResults();
    showEvalStatisticsData();
    setMobileActivePage("detail");
  } else {
    els.evalListModeBtn?.classList.add("active");
    els.evalStatsModeBtn?.classList.remove("active");
    if (state.results.length > 0) {
      loadCard(state.results[0].id);
    } else {
      els.detail.innerHTML = `
        <div class="detail-view-tabs">
          <button class="view-tab-btn active" onclick="window.setEvalViewMode('list')">💬 评语详情</button>
          <button class="view-tab-btn" onclick="window.setEvalViewMode('stats')">📈 评分统计</button>
        </div>
        <div class="empty-state">当前结果列表为空，没有可展示评语的卡牌</div>
      `;
      setMobileActivePage("detail");
    }
  }
};

function filterSummary(filters) {
  const parts = [];
  if (filters.q) parts.push(`关键词：${filters.q}`);
  if (filters.category) parts.push(`类别：${filters.category}`);
  if (filters.author) parts.push(`作者：${filters.author}`);
  if (filters.is_exclusive === "1") parts.push("专属特技");
  if (filters.is_identity === "1") parts.push("身份特技");
  return parts.length ? parts.join("；") : "当前牌库，不含废弃记录";
}

async function showCardSearchStatistics() {
  setDocumentMode(false);
  const stats = state.currentStats;
  if (!stats) return;

  state.activeId = null;
  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");

  const filters = {
    q: els.cardQ.value,
    category: els.cardCategory.value,
    author: els.cardAuthor.value,
    is_exclusive: els.cardExclusive.checked ? "1" : "0",
    is_identity: els.cardIdentity.checked ? "1" : "0",
  };

  els.detail.innerHTML = `
    <div class="detail-view-tabs">
      <button class="view-tab-btn" onclick="window.setCardViewMode('detail')">📄 单卡详情</button>
      <button class="view-tab-btn active" onclick="window.setCardViewMode('stats')">📊 汇总统计</button>
    </div>
    <div class="detail-title">
      <h2>筛选统计</h2>
      <span class="badge">动态</span>
    </div>
    <div class="text-block stat-filter-summary">${filterSummary(filters)}</div>
    
    <div class="stat-sort-switcher">
      <span>排序方式：</span>
      <label class="sort-radio-label">
        <input type="radio" name="statSort" value="count" ${state.statSortMode === "count" ? "checked" : ""}>
        <span>数量由多到少</span>
      </label>
      <label class="sort-radio-label">
        <input type="radio" name="statSort" value="custom" ${state.statSortMode === "custom" ? "checked" : ""}>
        <span>自定义分类</span>
      </label>
    </div>

    <div class="stats-grid">
      ${kv("卡牌", `${stats.card_count || 0} 张`)}
      ${kv("特技/说明", `${stats.ability_count || 0} 条`)}
      ${kv("专属特技", `${stats.exclusive_ability_count || 0} 张`)}
      ${kv("身份特技", `${stats.identity_ability_count || 0} 张`)}
    </div>
    <div class="section statistics-section">
      <h3>卡牌类型</h3>
      <ul class="stat-list">${counterList(sortCounter(Object.entries(stats.category_counts), "category"))}</ul>
    </div>
    <div class="section statistics-section">
      <h3>特技类型</h3>
      <ul class="stat-list">${counterList(sortCounter(Object.entries(stats.ability_kind_counts), "ability"))}</ul>
    </div>
    <div class="section statistics-section">
      <h3>作者</h3>
      <ul class="stat-list">${counterList(sortCounter(Object.entries(stats.author_counts), "author"))}</ul>
    </div>
    <div class="section statistics-section">
      <h3>出处</h3>
      <ul class="stat-list">${counterList(sortCounter(Object.entries(stats.source_work_counts), "source_work"))}</ul>
    </div>
    <div class="section statistics-section">
      <h3>说明</h3>
      <div class="text-block">统计按当前左侧筛选条件实时计算；未选择类别时默认排除废弃记录。</div>
    </div>
  `;

  els.detail.querySelectorAll('input[name="statSort"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.statSortMode = e.target.value;
      showCardSearchStatistics();
    });
  });
}

function renderChangeCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  return `
    <div class="section review-section">
      <h3>改卡候选</h3>
      <div class="candidate-list">
        ${candidates.map((candidate) => `
          <article class="candidate-card">
            <div class="candidate-header">
              <strong>${highlight(candidate.id || "未命名候选")}</strong>
              <span>${escapeHtml([candidate.status || "draft", candidate.ai_position].filter(Boolean).join(" · "))}</span>
            </div>
            ${renderReviewField("类型", candidate.candidate_type)}
            ${renderReviewField("修改意图", candidate.request)}
            ${renderReviewField("设计目标", candidate.design_goal)}
            ${renderReviewField("理由", candidate.rationale)}
            ${renderReviewField("当前摘要", candidate.current_snapshot)}
            ${renderReviewField("评审", candidate.review)}
            ${renderReviewField("候选完整文本", candidate.proposed_full_text)}
            ${renderReviewField("局部修改", candidate.proposed_patch)}
            ${renderReviewField("更新说明", candidate.patch_notes)}
            ${renderReviewField("待作者裁定", candidate.author_decision_needed)}
            ${renderReviewField("待办", candidate.source_tasks)}
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

async function loadCard(id, isUserTriggered = false) {
  state.activeId = id;
  if (state.activeTab === "card-search") {
    state.cardDisplayMode = "detail";
  } else if (state.activeTab === "eval") {
    state.evalDisplayMode = "list";
    els.evalListModeBtn?.classList.add("active");
    els.evalStatsModeBtn?.classList.remove("active");
  }
  if (isUserTriggered) {
    setMobileActivePage("detail");
  }
  renderResults();
  const card = await getJson(`/api/card/${encodeURIComponent(id)}`);
  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");
  els.detail.innerHTML = `
    ${(() => {
      if (state.activeTab === "card-search") {
        return `
          <div class="detail-view-tabs">
            <button class="view-tab-btn active" onclick="window.setCardViewMode('detail')">📄 单卡详情</button>
            <button class="view-tab-btn" onclick="window.setCardViewMode('stats')">📊 汇总统计</button>
          </div>
        `;
      } else if (state.activeTab === "eval") {
        return `
          <div class="detail-view-tabs">
            <button class="view-tab-btn active" onclick="window.setEvalViewMode('list')">💬 评语详情</button>
            <button class="view-tab-btn" onclick="window.setEvalViewMode('stats')">📈 评分统计</button>
          </div>
        `;
      }
      return "";
    })()}
    <div class="detail-title">
      <h2>${highlight(card.title, "title")}</h2>
      <span class="badge ${categoryClass(card.category)}">${escapeHtml(card.category_label)}</span>
    </div>
    <div class="detail-grid">
      ${(() => {
        const isChar = card.category === "combat_characters" || card.category === "attached_characters" || card.category === "deprecated";
        const isItem = card.category === "items";
        let html = "";
        if (isChar) {
          html += kv("\u751f\u547d", card.life);
          html += kv("\u6027\u522b", card.gender);
          html += kv("\u5175\u5668", card.weapons);
        } else if (isItem) {
          html += kv("\u7c7b\u522b", card.item_category);
          html += kv("\u7279\u6027", card.traits);
        }
        html += kv("\u51fa\u5904", card.source_work);
        html += kv("\u4f5c\u8005", card.author_group);
        html += kv("\u4f4d\u7f6e", `${card.source_sheet}!${card.source_row}`);
        html += kv("ID", card.id);
        return html;
      })()}
    </div>
    ${card.image_url ? `
      <figure class="card-face">
        <img src="${escapeHtml(card.image_url)}" alt="${escapeHtml(card.title)} \u5361\u9762">
      </figure>
    ` : ""}
    ${renderIdentityRules(card)}
    <div class="section">
      <h3>\u63cf\u8ff0</h3>
      ${renderUnitGroups(card)}
    </div>
    ${renderStructureNotes(card.structure_notes)}
    <div class="section">
      <h3>\u5173\u7cfb</h3>
      <div class="text-block">${highlight(card.relationships || "\u2014", "relationships")}</div>
    </div>
    ${renderReviewLayer(card.review)}
    ${renderUnderstandingLayer(card.understanding_note)}
    ${renderEvaluationLayer(card.evaluation)}
    ${renderMaintenanceTodos(card.maintenance_todos)}
    ${renderChangeCandidates(card.change_candidates)}
  `;
}

function renderEvaluationDimension(key, dimension) {
  const distribution = dimension && dimension.distribution ? dimension.distribution : {};
  const evaluated = Number(dimension?.evaluated_count || 0);
  return `
    <section class="section evaluation-stat-card">
      <div class="evaluation-stat-heading">
        <h3>${escapeHtml(dimension?.label || key)}</h3>
        <span>${evaluated ? `${evaluated} 张已评分` : "尚未开始评分"}</span>
      </div>
      <div class="stats-grid compact-stats-grid">
        ${kv("平均", dimension?.average ?? "未评估")}
        ${kv("中位数", dimension?.median ?? "未评估")}
      </div>
      ${evaluated ? `<div class="score-distribution">
        ${Object.entries(distribution).map(([range, count]) => `
          <div class="score-bin">
            <span>${escapeHtml(range)}</span>
            <div class="score-bar"><i style="width:${Math.max(3, Number(count || 0) / evaluated * 100)}%"></i></div>
            <strong>${escapeHtml(count)}</strong>
          </div>
        `).join("")}
      </div>` : `<div class="text-block">字段已经预留；未评分卡保持空值，不按0分计入统计。</div>`}
    </section>
  `;
}

async function showEvaluationStatistics(forceFetch = false) {
  setDocumentMode(false);
  state.activeId = null;
  if (forceFetch || !state.currentEvalStats) {
    const params = new URLSearchParams({
      q: els.evalQ.value,
      scope: els.evalScope.value,
      category: els.evalCategory.value,
      author: els.evalAuthor.value,
      limit: 500,
    });
    const stats = await getJson(`/api/evaluation-stats?${params.toString()}`);
    state.currentEvalStats = stats;
  }
  showEvalStatisticsData();
}

async function showEvalStatisticsData() {
  const stats = state.currentEvalStats;
  if (!stats) return;

  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");
  const dimensions = stats.dimensions || {};
  els.detail.innerHTML = `
    <div class="detail-view-tabs">
      <button class="view-tab-btn" onclick="window.setEvalViewMode('list')">💬 评语详情</button>
      <button class="view-tab-btn active" onclick="window.setEvalViewMode('stats')">📈 评分统计</button>
    </div>
    <div class="detail-title">
      <h2>评价统计</h2>
      <span class="badge">二级评语层</span>
    </div>
    <div class="review-source-note evaluation-layer-warning">只统计当前筛选下的评价，未评估卡不会按0分计算；这些数据不参与牌面源数据检索。</div>
    <div class="stats-grid">
      ${kv("牌库卡牌", `${stats.total_card_count || 0} 张`)}
      ${kv("已有评价", `${stats.reviewed_card_count || 0} 张`)}
      ${kv("尚未评估", `${stats.unreviewed_card_count || 0} 张`)}
      ${kv("开放问题", `${stats.open_question_count || 0} 项`)}
    </div>
    <div class="evaluation-dimension-grid">
      ${Object.entries(dimensions).map(([key, dimension]) => renderEvaluationDimension(key, dimension)).join("")}
    </div>
    <section class="section statistics-section">
      <h3>评价状态</h3>
      <ul class="stat-list">${counterList(Object.entries(stats.status_counts || {}).sort((a, b) => b[1] - a[1]))}</ul>
    </section>
    <section class="section statistics-section">
      <h3>统计口径</h3>
      <div class="text-block">强度、泛用性、正面生存、侧面生存分别统计。爆发能力与控制能力已预留字段，当前没有评分时显示“尚未开始评分”。后续新增维度无需改动源卡牌数据库。</div>
    </section>
  `;
}
function setTab(tabName) {
  state.activeTab = tabName;
  const tabs = {
    "card-search": els.tabCard,
    "eval": els.tabEval,
    "docs": els.tabDocs,
  };
  const panels = {
    "card-search": els.cardSearchPanel,
    "eval": els.evalPanel,
    "docs": els.docsPanel,
  };
  Object.entries(tabs).forEach(([name, btn]) => btn?.classList.toggle("active", name === tabName));
  Object.entries(panels).forEach(([name, panel]) => panel?.classList.toggle("hidden", name !== tabName));

  if (tabName === "docs") {
    if (els.mTabList) els.mTabList.style.display = "none";
    if (els.mTabDetail) els.mTabDetail.style.display = "";
    if (els.mTabFilter) els.mTabFilter.innerHTML = "📖 目录";
    if (els.mTabDetail) els.mTabDetail.innerHTML = "📄 阅读";
    setMobileActivePage("filter");
  } else {
    if (els.mTabList) els.mTabList.style.display = "";
    if (els.mTabDetail) els.mTabDetail.style.display = "";
    if (els.mTabFilter) els.mTabFilter.innerHTML = "🎛️ 筛选";
    if (els.mTabList) els.mTabList.innerHTML = "📋 列表";
    if (els.mTabDetail) els.mTabDetail.innerHTML = "📊 详情";
    setMobileActivePage("filter");
  }
}

async function runCardSearch(isUserTriggered = false) {
  setDocumentMode(false);
  state.query = els.cardQ.value;
  state.scope = els.cardScope.value;
  state.abilityType = els.cardScope.value === "ability" ? els.cardAbilityType.value : "";
  const params = new URLSearchParams({
    q: els.cardQ.value,
    scope: els.cardScope.value,
    ability_type: state.abilityType,
    category: els.cardCategory.value,
    author: els.cardAuthor.value,
    sort: els.cardSort.value,
    limit: els.cardLimit.value,
    is_exclusive: els.cardExclusive.checked ? "1" : "0",
    is_identity: els.cardIdentity.checked ? "1" : "0",
  });

  const [searchData, statsData] = await Promise.all([
    getJson(`/api/search?${params.toString()}`),
    getJson(`/api/stat-query?${params.toString()}`)
  ]);

  state.results = searchData.results;
  state.currentStats = statsData;

  renderResults();

  if (state.activeId === null || !state.results.some((row) => row.id === state.activeId)) {
    state.activeId = null;
    state.cardDisplayMode = "stats";
    showCardSearchStatistics();
    if (isUserTriggered) setMobileActivePage("list");
  } else {
    state.cardDisplayMode = "detail";
    loadCard(state.activeId, isUserTriggered);
  }
}

async function runEvalSearch(isUserTriggered = false) {
  setDocumentMode(false);
  state.query = els.evalQ.value;
  state.scope = els.evalScope.value;
  const params = new URLSearchParams({
    q: els.evalQ.value,
    scope: els.evalScope.value,
    category: els.evalCategory.value,
    author: els.evalAuthor.value,
    limit: 500,
  });

  const [searchData, statsData] = await Promise.all([
    getJson(`/api/evaluation-search?${params.toString()}`),
    getJson(`/api/evaluation-stats?${params.toString()}`)
  ]);

  state.results = searchData.results;
  state.currentEvalStats = statsData;

  renderResults();

  if (state.evalDisplayMode === "stats" || state.activeId === null || !state.results.some((row) => row.id === state.activeId)) {
    state.activeId = null;
    state.evalDisplayMode = "stats";
    showEvalStatisticsData();
    if (isUserTriggered) setMobileActivePage("list");
  } else {
    state.evalDisplayMode = "list";
    loadCard(state.activeId, isUserTriggered);
  }
}

function bindEvents() {
  // ① Card search panel
  els.cardSearchBtn?.addEventListener("click", () => runCardSearch(true));
  els.cardQ?.addEventListener("keydown", (e) => { if (e.key === "Enter") runCardSearch(true); });
  els.cardScope?.addEventListener("change", () => {
    if (els.cardScope.value === "ability") {
      els.cardAbilityTypeField.classList.remove("hidden");
    } else {
      els.cardAbilityTypeField.classList.add("hidden");
      els.cardAbilityType.value = "";
    }
  });
  [els.cardScope, els.cardAbilityType, els.cardCategory, els.cardAuthor, els.cardSort, els.cardLimit]
    .filter(Boolean)
    .forEach((el) => el.addEventListener("change", () => runCardSearch(false)));
  els.cardExclusive?.addEventListener("change", () => runCardSearch(false));
  els.cardIdentity?.addEventListener("change", () => runCardSearch(false));
  els.cardResetBtn?.addEventListener("click", () => {
    els.cardQ.value = "";
    els.cardScope.value = "all";
    els.cardAbilityType.value = "";
    els.cardAbilityTypeField.classList.add("hidden");
    els.cardCategory.value = "";
    els.cardAuthor.value = "";
    els.cardSort.value = "sheet";
    els.cardLimit.value = "60";
    els.cardExclusive.checked = false;
    els.cardIdentity.checked = false;
    runCardSearch(false);
  });

  // ③ Eval panel
  els.evalListModeBtn?.addEventListener("click", () => {
    window.setEvalViewMode("list");
  });
  els.evalStatsModeBtn?.addEventListener("click", () => {
    window.setEvalViewMode("stats");
  });
  els.evalSearchBtn?.addEventListener("click", () => runEvalSearch(true));
  els.evalQ?.addEventListener("keydown", (e) => { if (e.key === "Enter") runEvalSearch(true); });
  [els.evalScope, els.evalCategory, els.evalAuthor].filter(Boolean).forEach((el) =>
    el.addEventListener("change", () => runEvalSearch(false))
  );
  els.evalResetBtn?.addEventListener("click", () => {
    els.evalQ.value = "";
    els.evalScope.value = "all";
    els.evalCategory.value = "";
    els.evalAuthor.value = "";
    runEvalSearch(false);
  });

  // Top tab buttons
  els.tabCard?.addEventListener("click", () => {
    setTab("card-search");
    setDocumentMode(false);
    runCardSearch();
  });
  els.tabEval?.addEventListener("click", () => {
    setTab("eval");
    setDocumentMode(false);
    if (state.evalDisplayMode === "stats") {
      showEvaluationStatistics();
    } else {
      runEvalSearch();
    }
  });
  els.tabDocs?.addEventListener("click", () => {
    setTab("docs");
    showDocuments("");
  });

  // 📱 Mobile tab bar bindings
  els.mTabFilter?.addEventListener("click", () => setMobileActivePage("filter"));
  els.mTabList?.addEventListener("click", () => setMobileActivePage("list"));
  els.mTabDetail?.addEventListener("click", () => {
    if (state.activeTab === "docs") {
      setMobileActivePage("detail");
    } else if (state.activeId === null) {
      if (state.activeTab === "card-search") {
        window.setCardViewMode("stats");
      } else if (state.activeTab === "eval") {
        window.setEvalViewMode("stats");
      }
    } else {
      setMobileActivePage("detail");
    }
  });
}

async function main() {
  bindEvents();
  await loadMeta();
  setTab("card-search");
  await runCardSearch();
}

main().catch((error) => {
  console.error(error);
  els.results.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
