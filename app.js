const state = {
  results: [],
  activeId: null,
  query: "",
  scope: "all",
  abilityType: "",
  statSortMode: "count",
  currentStats: null,
};

const els = {
  dbMeta: document.querySelector("#dbMeta"),
  query: document.querySelector("#queryInput"),
  scope: document.querySelector("#scopeSelect"),
  abilityTypeField: document.querySelector("#abilityTypeField"),
  abilityType: document.querySelector("#abilityTypeSelect"),
  category: document.querySelector("#categorySelect"),
  author: document.querySelector("#authorSelect"),
  sort: document.querySelector("#sortSelect"),
  limit: document.querySelector("#limitSelect"),
  search: document.querySelector("#searchButton"),
  reset: document.querySelector("#resetButton"),
  statistics: document.querySelector("#statisticsButton"),
  stats: document.querySelector("#statsPanel"),
  count: document.querySelector("#resultCount"),
  results: document.querySelector("#resultsList"),
  empty: document.querySelector("#emptyState"),
  detail: document.querySelector("#cardDetail"),
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

function staticMatchesScope(card, q, scope, abilityType = "") {
  const nq = normalizeTitle(q);
  const abilities = Array.isArray(card.abilities) ? card.abilities : [];
  const units = Array.isArray(card.units) ? card.units : [];
  if (!q) {
    if (scope === "ability" && abilityType) {
      return abilities.some((ability) => ability.kind === abilityType);
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
    card.all_text,
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

function staticFilteredCards({ q = "", scope = "all", abilityType = "", category = "", author = "" } = {}) {
  return Object.values(STATIC_DATA.cards)
    .filter((card) => category ? card.category === category : card.category !== "deprecated")
    .filter((card) => author ? card.author_group === author : true)
    .filter((card) => staticMatchesScope(card, q, scope, abilityType));
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
  return /[（(]身份[）)]\s*$/.test(String(ability?.text || "").trim());
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
    return Promise.resolve(STATIC_DATA.meta);
  }
  if (parsed.pathname.endsWith("/api/statistics")) {
    return Promise.resolve(STATIC_DATA.statistics || {});
  }
  if (parsed.pathname.endsWith("/api/stat-query")) {
    return Promise.resolve(staticStatQuery({
      q: (parsed.searchParams.get("q") || "").trim(),
      scope: parsed.searchParams.get("scope") || "all",
      abilityType: parsed.searchParams.get("ability_type") || "",
      category: parsed.searchParams.get("category") || "",
      author: parsed.searchParams.get("author") || "",
    }));
  }
  if (parsed.pathname.endsWith("/api/search")) {
    const q = (parsed.searchParams.get("q") || "").trim();
    const scope = parsed.searchParams.get("scope") || "all";
    const abilityType = parsed.searchParams.get("ability_type") || "";
    const category = parsed.searchParams.get("category") || "";
    const author = parsed.searchParams.get("author") || "";
    const sort = parsed.searchParams.get("sort") || "sheet";
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") || 60), 1), 500);
    const cards = staticFilteredCards({ q, scope, abilityType, category, author })
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
  els.dbMeta.textContent = `${meta.record_count} 张，${meta.source_workbook}`;
  els.stats.innerHTML = meta.by_category
    .map((row) => `<div>${escapeHtml(row.category_label)}：${row.count}</div>`)
    .join("");

  els.category.append(option("全部", ""));
  meta.categories.forEach((item) => els.category.append(option(item.label, item.value)));

  els.author.append(option("全部", ""));
  meta.authors.forEach((name) => els.author.append(option(name, name)));
}

function renderResults() {
  els.count.textContent = `${state.results.length} 条`;
  els.results.innerHTML = "";

  if (state.results.length === 0) {
    els.results.innerHTML = '<div class="empty-state">没有匹配结果</div>';
    return;
  }

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
      <div class="meta">${escapeHtml(row.author_group || "")} ${escapeHtml(row.source_work || "")} · ${escapeHtml(row.source_sheet)}!${row.source_row}</div>
      <div class="snippet">${highlight(compact(row.snippet || row.description || row.relationships || ""), state.scope)}</div>
    `;
    button.addEventListener("click", () => loadCard(row.id));
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
          const name = ability.name ? `<span class="ability-name">${highlight(ability.name, "ability:" + kind)}${ability.name.endsWith("：") ? "" : "："}</span>` : "";
          const body = abilityBodyText(ability);
          const flags = Array.isArray(ability.review_flags) && ability.review_flags.length
            ? `<div class="ability-flags">${ability.review_flags.map((flag) => escapeHtml(flag)).join(" · ")}</div>`
            : "";
          return `
            <div class="ability-block ${className}">
              <div class="ability-kind">${escapeHtml(kind)}</div>
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
    const rows = Object.entries(value);
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

function currentFilterParams() {
  return {
    q: els.query.value,
    scope: els.scope.value,
    category: els.category.value,
    author: els.author.value,
  };
}

function filterSummary(filters) {
  const parts = [];
  if (filters.q) parts.push(`关键词：${filters.q}`);
  if (filters.scope && filters.scope !== "all") {
    const selected = els.scope.options[els.scope.selectedIndex];
    parts.push(`范围：${selected ? selected.textContent : filters.scope}`);
  }
  if (filters.category) {
    const selected = els.category.options[els.category.selectedIndex];
    parts.push(`类别：${selected ? selected.textContent : filters.category}`);
  }
  if (filters.author) parts.push(`作者：${filters.author}`);
  return parts.length ? parts.join("；") : "当前牌库，不含废弃记录";
}

async function showStatistics(forceFetch = false) {
  const filters = currentFilterParams();
  if (forceFetch || !state.currentStats) {
    const stats = await getJson(`/api/stat-query?${new URLSearchParams(filters).toString()}`);
    state.currentStats = stats;
  }
  const stats = state.currentStats;
  state.activeId = null;
  renderResults();
  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");
  els.detail.innerHTML = `
    <div class="detail-title">
      <h2>筛选统计</h2>
      <span class="badge">动态</span>
    </div>
    <div class="text-block stat-filter-summary">${highlight(filterSummary(filters))}</div>
    
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
      ${kv("专属特技", `${stats.exclusive_ability_count || 0} 条`)}
      ${kv("身份特技", `${stats.identity_ability_count || 0} 条`)}
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
              <span>${escapeHtml(candidate.status || "draft")}</span>
            </div>
            ${renderReviewField("修改意图", candidate.request)}
            ${renderReviewField("理由", candidate.rationale)}
            ${renderReviewField("候选完整文本", candidate.proposed_full_text)}
            ${renderReviewField("更新说明", candidate.patch_notes)}
            ${renderReviewField("待办", candidate.source_tasks)}
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

async function loadCard(id) {
  state.activeId = id;
  renderResults();
  const card = await getJson(`/api/card/${encodeURIComponent(id)}`);
  els.empty.classList.add("hidden");
  els.detail.classList.remove("hidden");
  els.detail.innerHTML = `
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
          html += kv("生命", card.life);
          html += kv("性别", card.gender);
          html += kv("兵器", card.weapons);
        } else if (isItem) {
          html += kv("类别", card.item_category);
          html += kv("特性", card.traits);
        }
        html += kv("出处", card.source_work);
        html += kv("作者", card.author_group);
        html += kv("位置", `${card.source_sheet}!${card.source_row}`);
        html += kv("ID", card.id);
        return html;
      })()}
    </div>
    ${card.image_url ? `
      <figure class="card-face">
        <img src="${escapeHtml(card.image_url)}" alt="${escapeHtml(card.title)} 卡面">
      </figure>
    ` : ""}
    ${renderIdentityRules(card)}
    <div class="section">
      <h3>描述</h3>
      ${renderUnitGroups(card)}
    </div>
    ${renderStructureNotes(card.structure_notes)}
    <div class="section">
      <h3>关系</h3>
      <div class="text-block">${highlight(card.relationships || "—", "relationships")}</div>
    </div>
    ${renderReviewLayer(card.review)}
    ${renderChangeCandidates(card.change_candidates)}
  `;
}

async function runSearch() {
  state.query = els.query.value;
  state.scope = els.scope.value;
  state.abilityType = els.scope.value === "ability" ? els.abilityType.value : "";
  const params = new URLSearchParams({
    q: els.query.value,
    scope: els.scope.value,
    ability_type: state.abilityType,
    category: els.category.value,
    author: els.author.value,
    sort: els.sort.value,
    limit: els.limit.value,
  });
  const data = await getJson(`/api/search?${params.toString()}`);
  state.results = data.results;
  if (!state.results.some((row) => row.id === state.activeId)) {
    state.activeId = null;
    els.detail.classList.add("hidden");
    els.empty.classList.remove("hidden");
  }
  renderResults();
}

function bindEvents() {
  els.search.addEventListener("click", runSearch);
  els.reset.addEventListener("click", () => {
    els.query.value = "";
    els.scope.value = "all";
    els.abilityType.value = "";
    els.abilityTypeField.classList.add("hidden");
    els.category.value = "";
    els.author.value = "";
    els.sort.value = "sheet";
    els.limit.value = "60";
    state.currentStats = null;
    runSearch();
  });
  els.statistics.addEventListener("click", () => showStatistics(true));
  els.query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  
  els.scope.addEventListener("change", () => {
    if (els.scope.value === "ability") {
      els.abilityTypeField.classList.remove("hidden");
    } else {
      els.abilityTypeField.classList.add("hidden");
      els.abilityType.value = "";
    }
  });

  [els.scope, els.abilityType, els.category, els.author, els.sort, els.limit].forEach((el) => {
    el.addEventListener("change", runSearch);
  });

  els.detail.addEventListener("change", (event) => {
    if (event.target.name === "statSort") {
      state.statSortMode = event.target.value;
      showStatistics(false);
    }
  });
}

async function main() {
  bindEvents();
  await loadMeta();
  await runSearch();
}

main().catch((error) => {
  console.error(error);
  els.results.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
