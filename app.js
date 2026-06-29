const state = {
  connected: false,
  selectedGuid: "",
  selectedInfo: null,
  projectId: "",
  buildingId: "",
  userEmail: "",
  workflows: new Map(),
  signatureEntries: [],
  topicMapEntries: [],
  topicMapFloors: [],
  topicMapFloorId: "",
  topicMapMarkersByFloor: new Map(),
  topicLookupById: new Map(),
  topicLookupByPublicId: new Map(),
  currentSpaceGuids: [],
  currentSpaceNames: new Map(),
  currentSpaceRecords: [],
  currentSpaceTopicEntries: [],
  currentCameraState: null,
  currentSpaceFilterReady: false,
};

const STREAMBIM_SCRIPT_CANDIDATES = [
  "https://cdn.jsdelivr.net/npm/streambim-widget-api@2.0.1/dist/streambim-widget-api.min.js",
  "https://unpkg.com/streambim-widget-api@2.0.1/dist/streambim-widget-api.min.js",
  "https://cdn.jsdelivr.net/gh/streambim/streambim-widget-api@master/dist/streambim-widget-api.min.js",
];

const CHECKLIST_STATUS_IDS = {
  open: "2000",
  done: "3000",
  closed: "4000",
  notRelevant: "4500",
};

const TARGET_SIGNATURE_DEBUG = {
  checklistId: "14",
  snapshotId: "3",
  itemInstanceId: "1897",
};

const elements = {
  connectionBadge: document.getElementById("connection-badge"),
  selectionBadge: document.getElementById("selection-badge"),
  projectId: document.getElementById("project-id"),
  buildingId: document.getElementById("building-id"),
  userEmail: document.getElementById("user-email"),
  selectedGuid: document.getElementById("selected-guid"),
  objectSummary: document.getElementById("object-summary"),
  propertiesRoot: document.getElementById("properties-root"),
  emptyState: document.getElementById("empty-state"),
  actionFeedback: document.getElementById("action-feedback"),
  refreshContext: document.getElementById("refresh-context"),
  gotoObject: document.getElementById("goto-object"),
  highlightObject: document.getElementById("highlight-object"),
  copyGuid: document.getElementById("copy-guid"),
  loadChecklists: document.getElementById("load-checklists"),
  exportPdf: document.getElementById("export-pdf"),
  checklistEmpty: document.getElementById("checklist-empty"),
  checklistStatus: document.getElementById("checklist-status"),
  checklistRoot: document.getElementById("checklist-root"),
  refreshSpaceTopics: document.getElementById("refresh-space-topics"),
  openSpaceTopics: document.getElementById("open-space-topics"),
  spaceTopicsEmpty: document.getElementById("space-topics-empty"),
  spaceTopicsStatus: document.getElementById("space-topics-status"),
  spaceTopicsRoot: document.getElementById("space-topics-root"),
  spaceTopicsSummary: document.getElementById("space-topics-summary"),
  spaceTopicsList: document.getElementById("space-topics-list"),
  loadTopicMap: document.getElementById("load-topic-map"),
  topicMapEmpty: document.getElementById("topic-map-empty"),
  topicMapStatus: document.getElementById("topic-map-status"),
  topicMapRoot: document.getElementById("topic-map-root"),
  topicFloorPrev: document.getElementById("topic-floor-prev"),
  topicFloorSelect: document.getElementById("topic-floor-select"),
  topicFloorNext: document.getElementById("topic-floor-next"),
  topicMapSummary: document.getElementById("topic-map-summary"),
  topicMapList: document.getElementById("topic-map-list"),
  clearLog: document.getElementById("clear-log"),
  debugLog: document.getElementById("debug-log"),
};

function appendLog(title, payload) {
  const entry = document.createElement("article");
  entry.className = "debug-entry";

  const heading = document.createElement("strong");
  heading.textContent = title;

  const body = document.createElement("pre");
  if (typeof payload === "string") {
    body.textContent = payload;
  } else {
    try {
      body.textContent = JSON.stringify(payload, null, 2);
    } catch (error) {
      body.textContent = String(payload);
    }
  }

  entry.appendChild(heading);
  entry.appendChild(body);
  elements.debugLog.prepend(entry);
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve(src);
    script.onerror = () => reject(new Error(`Kunde inte ladda script: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureStreamBimLibrary() {
  if (window.StreamBIM) {
    appendLog("Bibliotek", "StreamBIM fanns redan pa window.");
    return;
  }

  let lastError = null;

  for (const src of STREAMBIM_SCRIPT_CANDIDATES) {
    try {
      appendLog("Laddar bibliotek", src);
      await loadExternalScript(src);
      if (window.StreamBIM) {
        appendLog("Bibliotek laddat", src);
        return;
      }
      lastError = new Error(`Scriptet laddades men window.StreamBIM saknas: ${src}`);
      appendLog("Bibliotek saknas efter load", src);
    } catch (error) {
      lastError = error;
      appendLog("Scriptfel", error.message || String(error));
    }
  }

  throw lastError || new Error("StreamBIM-biblioteket kunde inte laddas.");
}

function getApiMethod(methodName) {
  if (window.StreamBIM?.API && typeof window.StreamBIM.API[methodName] === "function") {
    return window.StreamBIM.API[methodName].bind(window.StreamBIM.API);
  }

  if (window.StreamBIM && typeof window.StreamBIM[methodName] === "function") {
    return window.StreamBIM[methodName].bind(window.StreamBIM);
  }

  return null;
}

async function callApi(methodName, ...args) {
  const method = getApiMethod(methodName);
  if (!method) {
    throw new Error(`API-metoden ${methodName} finns inte i denna StreamBIM-miljo.`);
  }

  appendLog(`API: ${methodName}`, { args });
  return method(...args);
}

function setConnectionState(connected, message) {
  state.connected = connected;
  elements.connectionBadge.textContent = message;
  elements.connectionBadge.className = connected ? "badge badge-live" : "badge badge-waiting";
  elements.loadChecklists.disabled = !connected;
  elements.loadTopicMap.disabled = !connected;
  elements.refreshSpaceTopics.disabled = !connected;
  updateOpenSpaceTopicsButton();
}

function updateOpenSpaceTopicsButton() {
  elements.openSpaceTopics.disabled = !state.connected || !state.currentSpaceFilterReady || !state.currentSpaceRecords.length;
}

function setSelectionState(message, active) {
  elements.selectionBadge.textContent = message;
  elements.selectionBadge.className = active ? "badge badge-active" : "badge badge-idle";
  const hasSelection = Boolean(state.selectedGuid);
  elements.gotoObject.disabled = !hasSelection;
  elements.highlightObject.disabled = !hasSelection;
  elements.copyGuid.disabled = !hasSelection;
  elements.selectedGuid.textContent = state.selectedGuid || "-";
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (Array.isArray(value)) {
    return value.map(formatValue).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function pickSummary(info) {
  return [
    ["GUID", info.guid || state.selectedGuid || "-"],
    ["Namn", info.name || info.Name || "-"],
    ["Typ", info.type || info.ifcType || info.Type || "-"],
    ["Beskrivning", info.description || info.Description || "-"],
  ];
}

function normalizePropertyGroups(info) {
  const groups = [];
  const reservedKeys = new Set([
    "guid",
    "Guid",
    "name",
    "Name",
    "type",
    "Type",
    "ifcType",
    "description",
    "Description",
    "properties",
  ]);

  if (info.properties && typeof info.properties === "object") {
    groups.push({
      title: "IFC-egenskaper",
      entries: Object.entries(info.properties),
    });
  }

  const metadataEntries = Object.entries(info).filter(([key]) => !reservedKeys.has(key));
  if (metadataEntries.length) {
    groups.unshift({
      title: "Metadata",
      entries: metadataEntries,
    });
  }

  return groups.filter((group) => group.entries.length);
}

function renderObjectInfo(info) {
  state.selectedInfo = info;
  elements.emptyState.classList.add("hidden");
  elements.objectSummary.classList.remove("hidden");
  elements.propertiesRoot.classList.remove("hidden");

  elements.objectSummary.innerHTML = "";
  for (const [label, value] of pickSummary(info)) {
    const card = document.createElement("div");
    card.className = "summary-card";
    const labelNode = document.createElement("span");
    labelNode.className = "summary-label";
    labelNode.textContent = label;

    const valueNode = document.createElement("span");
    valueNode.className = "summary-value";
    valueNode.textContent = formatValue(value);

    card.appendChild(labelNode);
    card.appendChild(valueNode);
    elements.objectSummary.appendChild(card);
  }

  elements.propertiesRoot.innerHTML = "";
  const groups = normalizePropertyGroups(info);

  for (const group of groups) {
    const wrapper = document.createElement("section");
    wrapper.className = "property-group";

    const title = document.createElement("h3");
    title.textContent = group.title;
    wrapper.appendChild(title);

    const table = document.createElement("table");
    table.className = "property-table";
    const body = document.createElement("tbody");

    for (const [key, value] of group.entries) {
      const row = document.createElement("tr");
      const keyCell = document.createElement("td");
      keyCell.className = "property-key";
      keyCell.textContent = key;

      const valueCell = document.createElement("td");
      valueCell.className = "property-value";
      valueCell.textContent = formatValue(value);

      row.appendChild(keyCell);
      row.appendChild(valueCell);
      body.appendChild(row);
    }

    table.appendChild(body);
    wrapper.appendChild(table);
    elements.propertiesRoot.appendChild(wrapper);
  }
}

function showError(message) {
  elements.actionFeedback.textContent = message;
  appendLog("Fel", message);
}

function extractGuid(result) {
  if (!result) {
    return "";
  }

  if (typeof result === "string") {
    return result;
  }

  return (
    result.guid ||
    result.objectGuid ||
    result.id ||
    result.object?.guid ||
    result.data?.guid ||
    ""
  );
}

async function loadProjectContext() {
  if (!state.connected) {
    return;
  }

  try {
    const [projectId, buildingId, userEmail] = await Promise.all([
      callApi("getProjectId"),
      callApi("getBuildingId"),
      callApi("getUserEmail"),
    ]);

    state.projectId = formatValue(projectId);
    state.buildingId = formatValue(buildingId);
    state.userEmail = formatValue(userEmail);
    elements.projectId.textContent = formatValue(projectId);
    elements.buildingId.textContent = formatValue(buildingId);
    elements.userEmail.textContent = formatValue(userEmail);
  } catch (error) {
    showError(`Kunde inte lasa projektinfo: ${error.message || error}`);
  }
}

function getViewerOrigin() {
  try {
    if (document.referrer) {
      return new URL(document.referrer).origin;
    }
  } catch (error) {
    appendLog("Viewer origin", `Kunde inte lasa document.referrer: ${error.message || error}`);
  }

  return "https://app.streambim.com";
}

function toAbsoluteViewerUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${getViewerOrigin()}${url}`;
}

function buildProjectApiUrl(pathWithQuery) {
  return toAbsoluteViewerUrl(`/project-${encodeURIComponent(state.projectId)}/api/v1/v2${pathWithQuery}`);
}

async function fetchJsonViaViewer(url, method = "GET", body = undefined) {
  const request = {
    url: toAbsoluteViewerUrl(url),
    method,
    accept: "application/vnd.api+json",
    contentType: "application/vnd.api+json",
  };

  if (body !== undefined) {
    request.body = body;
  }

  const raw = await callApi("makeApiRequest", request);
  appendLog("makeApiRequest svar", { url: request.url, raw: typeof raw === "string" ? raw.slice(0, 1000) : raw });
  if (typeof raw !== "string") {
    return raw;
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    throw new Error(`API-svaret for ${request.url} var HTML i stallet for JSON.`);
  }

  return JSON.parse(raw);
}

function readTopicObjectGuid(topic) {
  const attrs = topic?.attributes || {};
  return (
    attrs.ifcObjectGuid ||
    attrs["ifc-object-guid"] ||
    attrs.ifcGuid ||
    attrs["ifc-guid"] ||
    attrs.objectGuid ||
    attrs["object-guid"] ||
    ""
  );
}

function readRelationshipIds(record, relationshipName) {
  const items = record?.relationships?.[relationshipName]?.data;
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => String(item?.id || "").trim())
    .filter(Boolean);
}

function mergeUniqueStrings(...groups) {
  return [...new Set(groups.flat().map((value) => String(value || "").trim()).filter(Boolean))];
}

function topicMatchesSelectedObject(topic, guid) {
  const value = readTopicObjectGuid(topic);
  if (Array.isArray(value)) {
    return value.includes(guid);
  }
  return value === guid;
}

function isChecklistTopic(topic) {
  const checklistRelation = topic?.relationships?.["checklist-item-instance"]?.data;
  if (checklistRelation) {
    return true;
  }

  const attrs = topic?.attributes || {};
  const topicType = `${attrs["topic-type"] || attrs.topicType || ""}`.toLowerCase();
  const channel = `${attrs.channel || ""}`.toLowerCase();
  return topicType.includes("checklist") || channel.includes("checklist");
}

function collectStrings(value, bucket = []) {
  if (value === null || value === undefined) {
    return bucket;
  }

  if (typeof value === "string") {
    bucket.push(value);
    return bucket;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, bucket));
    return bucket;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, bucket));
  }

  return bucket;
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function encodeBase64Unicode(value) {
  return btoa(unescape(encodeURIComponent(String(value))));
}

function buildChecklistUrl(checklistId, objectId = "") {
  let url = `https://app.streambim.com/webapp/default/#/viewer/checklists/checklist/${encodeURIComponent(checklistId)}`;
  if (objectId) {
    url += `/object/${encodeURIComponent(objectId)}`;
  }
  url += `?apply=false&projectId=${encodeURIComponent(state.projectId)}`;
  return url;
}

function buildChecklistItemUrl(checklistId, objectId = "", itemId = "", snapshotId = "") {
  let url = `https://app.streambim.com/webapp/default/#/viewer/checklists/checklist/${encodeURIComponent(checklistId)}`;
  if (objectId) {
    url += `/object/${encodeURIComponent(objectId)}`;
  }
  if (itemId) {
    url += `/item/${encodeURIComponent(itemId)}`;
  }

  const params = new URLSearchParams({
    apply: "false",
    projectId: String(state.projectId || ""),
  });

  if (state.buildingId) {
    params.set("buildingId", String(state.buildingId));
  }
  if (snapshotId) {
    params.set("snapshotId", String(snapshotId));
  }

  return `${url}?${params.toString()}`;
}

function matchesSignatureLabel(value) {
  return normalizeWhitespace(value).toLowerCase().includes("33. signatur");
}

function looksLikeSignatureField(values) {
  const strings = uniqueStrings(collectStrings(values));
  const normalized = strings.map((value) => normalizeWhitespace(value).toLowerCase());

  if (normalized.some((value) => value.includes("33. signatur"))) {
    return true;
  }

  const has33 = normalized.some((value) => value === "33" || value.startsWith("33.") || value.includes(" 33"));
  const hasSignatureWord = normalized.some((value) => value.includes("signatur") || value.includes("signature"));
  return has33 && hasSignatureWord;
}

function isDoneStatus(status) {
  if (!status) {
    return false;
  }

  if (typeof status === "string") {
    const normalized = status.toLowerCase();
    return normalized === "done" || normalized === CHECKLIST_STATUS_IDS.done || normalized === CHECKLIST_STATUS_IDS.notRelevant;
  }

  if (typeof status === "object") {
    return Boolean(
      status.done ||
        status.isDone ||
        status.value === "done" ||
        status.name === "done" ||
        status.id === "done" ||
        status.status === "done" ||
        status.value === CHECKLIST_STATUS_IDS.done ||
        status.id === CHECKLIST_STATUS_IDS.done ||
        status.status === CHECKLIST_STATUS_IDS.done ||
        status.value === CHECKLIST_STATUS_IDS.notRelevant ||
        status.id === CHECKLIST_STATUS_IDS.notRelevant ||
        status.status === CHECKLIST_STATUS_IDS.notRelevant,
    );
  }

  return false;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function collectSignatureValues(value) {
  return uniqueStrings(
    collectStrings(value).filter((entry) => {
      const normalized = normalizeWhitespace(entry);
      if (!normalized) {
        return false;
      }

      const lowered = normalized.toLowerCase();
      if (/^[A-Za-z0-9_$:+-]{10,}$/.test(normalized) && !normalized.includes("@")) {
        return false;
      }
      return ![
        "33. signatur",
        "signature",
        "signatur",
        "done",
        "open",
        "not started",
        "in progress",
      ].includes(lowered);
    }),
  );
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}

function buildChecklistExportQuery({
  key,
  checklistId = "",
  snapshotId = "",
  page = { skip: 0, limit: -1 },
  sort = { field: "title", descending: false },
  filters = [],
  filename = "",
  format = "json",
}) {
  const filter = {};

  if (checklistId) {
    filter.checklist = checklistId;
  }

  if (snapshotId) {
    if (snapshotId === "all") {
      if (checklistId) {
        filter.allSnapshots = true;
      }
    } else {
      filter.snapshotId = snapshotId;
    }
  }

  for (const item of filters) {
    if (!item?.key) {
      continue;
    }
    filter[item.key] = item.value;
  }

  return {
    key,
    sort,
    page,
    filter,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    format,
    filename,
  };
}

async function fetchChecklistExport(options) {
  const query = buildChecklistExportQuery(options);
  const encodedQuery = encodeBase64Unicode(JSON.stringify(query));
  return fetchJsonViaViewer(`/checklists/export/json/?query=${encodeURIComponent(encodedQuery)}`);
}

function extractSignatureCandidates(text) {
  const candidates = [];
  const patterns = [
    /33\.\s*Signatur\s*[:\-]\s*([^\n\r;|]+)/gi,
    /33\.\s*Signatur\s*"\s*[:\-]\s*"([^"]+)"/gi,
    /33\.\s*Signatur\s*\n+\s*([^\n\r]+)/gi,
    /33\.\s*Signatur\s*\r?\n\s*([^\n\r]+)/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      const value = normalizeWhitespace(match[1]);
      if (value && !/^33\.\s*Signatur$/i.test(value)) {
        candidates.push(value);
      }
      match = pattern.exec(text);
    }
  }

  if (!candidates.length && /33\.\s*Signatur/i.test(text)) {
    const compact = normalizeWhitespace(text);
    const index = compact.toLowerCase().indexOf("33. signatur");
    if (index !== -1) {
      const tail = compact.slice(index + "33. Signatur".length).replace(/^[:\-\s]+/, "");
      if (tail) {
        candidates.push(tail.slice(0, 120));
      }
    }
  }

  return [...new Set(candidates)];
}

function buildTopicDetailUrl(topicId) {
  return `https://app.streambim.com/webapp/default/#/viewer/topics/detail/${topicId}?projectId=${encodeURIComponent(state.projectId)}`;
}

function buildTopicsIndexUrl() {
  const origin = getViewerOrigin();
  const params = new URLSearchParams();
  if (state.projectId) {
    params.set("projectId", state.projectId);
  }
  params.set("selectionBarOption", "0");
  params.set("expanded", "true");
  return `${origin}/webapp/default/#/viewer/topics?${params.toString()}`;
}

function navigateTopWindow(url) {
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_top";
    anchor.rel = "noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch (error) {
    appendLog("anchor navigation fel", {
      url,
      error: error.message || String(error),
    });
  }

  const targets = [window.top, window.parent, window];

  for (const target of targets) {
    try {
      if (target?.location) {
        target.location.href = url;
        return true;
      }
    } catch (error) {
      appendLog("navigation fel", {
        url,
        error: error.message || String(error),
      });
    }
  }

  try {
    const opened = window.open(url, "_top");
    return opened !== null;
  } catch (error) {
    appendLog("window.open fel", {
      url,
      error: error.message || String(error),
    });
  }

  return false;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function loadWorkflows() {
  if (!state.projectId) {
    await loadProjectContext();
  }

  const payload = await fetchJsonViaViewer(`/project-${state.projectId}/api/v1/v2/workflows`);
  state.workflows = new Map(
    (payload.data || []).map((workflow) => [
      workflow.id,
      workflow.attributes?.title || workflow.attributes?.name || `Workflow ${workflow.id}`,
    ]),
  );
  appendLog("workflows laddade", { count: state.workflows.size });
}

async function loadTopicComments(topicId) {
  const payload = await fetchJsonViaViewer(
    `/project-${state.projectId}/api/v1/v2/topic-comments?page[limit]=100&page[skip]=0&filter[topic]=${encodeURIComponent(topicId)}`,
  );
  return payload.data || [];
}

function renderChecklistCards(cards, mode) {
  elements.checklistEmpty.classList.add("hidden");
  elements.checklistRoot.classList.remove("hidden");
  elements.checklistRoot.innerHTML = "";

  for (const cardData of cards) {
    const article = document.createElement("article");
    article.className = "checklist-card";

    const heading = document.createElement("h3");
    heading.textContent = cardData.title;
    article.appendChild(heading);

    const meta = document.createElement("div");
    meta.className = "checklist-meta";
    [
      cardData.workflow,
      cardData.status,
      `Topic ${cardData.publicId}`,
      cardData.objectGuid ? `Objekt ${cardData.objectGuid}` : "",
      cardData.checklistInstanceId ? `Checklist ${cardData.checklistInstanceId}` : "",
    ]
      .filter(Boolean)
      .forEach((text) => {
        const chip = document.createElement("span");
        chip.className = "meta-chip";
        chip.textContent = text;
        meta.appendChild(chip);
      });
    article.appendChild(meta);

    const copy = document.createElement("p");
    copy.className = "checklist-copy";
    copy.textContent = cardData.description || "Ingen beskrivning registrerad.";
    article.appendChild(copy);

    if (cardData.comments.length) {
      const commentsRoot = document.createElement("div");
      commentsRoot.className = "comment-list";

      cardData.comments.forEach((comment) => {
        const wrapper = document.createElement("article");
        wrapper.className = "comment-card";

        const author = document.createElement("strong");
        author.textContent = comment.author || "Okand avsandare";
        wrapper.appendChild(author);

        const metaLine = document.createElement("span");
        metaLine.textContent = comment.created || "-";
        wrapper.appendChild(metaLine);

        const text = document.createElement("p");
        text.textContent = comment.comment || "Tom kommentar";
        wrapper.appendChild(text);
        commentsRoot.appendChild(wrapper);
      });

      article.appendChild(commentsRoot);
    }

    elements.checklistRoot.appendChild(article);
  }

  elements.checklistStatus.textContent =
    mode === "object"
      ? `Hittade ${cards.length} checklistrelaterade poster kopplade till valt objekt.`
      : `Hittade inga objektkopplade checklistor. Visar ${cards.length} senaste checklistposter i projektet i stallet.`;
}

function normalizeChecklistCard(topic, comments) {
  const attrs = topic.attributes || {};
  const workflowId = topic.relationships?.workflow?.data?.id;
  const statusId = topic.relationships?.status?.data?.id;
  const checklistInstanceId = topic.relationships?.["checklist-item-instance"]?.data?.id || "";

  return {
    id: topic.id,
    title: attrs.title || attrs["teaser-text"] || `Topic ${topic.id}`,
    description: attrs.description || attrs["teaser-text"] || "",
    publicId: attrs["public-id"] || topic.id,
    workflow: state.workflows.get(workflowId) || workflowId || "Okant workflow",
    status: statusId || "Okand status",
    objectGuid: readTopicObjectGuid(topic),
    checklistInstanceId,
    comments: comments.map((comment) => ({
      author: comment.relationships?.["creation-author"]?.data?.id || "",
      created: comment.attributes?.["creation-date"] || "",
      comment: comment.attributes?.comment || "",
    })),
  };
}

async function loadAllTopics() {
  const limit = 200;
  const topics = [];
  let skip = 0;

  while (true) {
    const payload = await fetchJsonViaViewer(
      `/project-${state.projectId}/api/v1/v2/topics?page[limit]=${limit}&page[skip]=${skip}`,
    );
    const chunk = payload.data || [];
    topics.push(...chunk);
    appendLog("topics page", { skip, fetched: chunk.length, total: topics.length });
    if (chunk.length < limit) {
      break;
    }
    skip += limit;
  }

  return topics;
}

function getTopicTitle(topic) {
  const attrs = topic?.attributes || {};
  return attrs.title || attrs["teaser-text"] || `Arende ${topic.id}`;
}

function getTopicPublicId(topic) {
  return topic?.attributes?.["public-id"] || topic?.id || "-";
}

function getTopicStatusLabel(topic) {
  const statusId = String(topic?.relationships?.status?.data?.id || "");
  if (statusId === CHECKLIST_STATUS_IDS.open) {
    return "Open";
  }
  if (statusId === CHECKLIST_STATUS_IDS.done) {
    return "Done";
  }
  if (statusId === CHECKLIST_STATUS_IDS.closed) {
    return "Closed";
  }
  if (statusId === CHECKLIST_STATUS_IDS.notRelevant) {
    return "Ej relevant";
  }
  return statusId || "Okand status";
}

function getTopicStatusKey(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "open" || normalized === CHECKLIST_STATUS_IDS.open) {
    return "open";
  }
  if (normalized === "done" || normalized === CHECKLIST_STATUS_IDS.done) {
    return "done";
  }
  if (normalized === "closed" || normalized === CHECKLIST_STATUS_IDS.closed) {
    return "closed";
  }
  return "other";
}

function getTopicStatusClass(status) {
  return `topic-status-${getTopicStatusKey(status)}`;
}

function getTopicWorkflowLabel(topic) {
  const workflowId = topic?.relationships?.workflow?.data?.id || "";
  return state.workflows.get(workflowId) || workflowId || "Okant workflow";
}

function getViewpointSelectionGuid(viewpoint) {
  const selection = viewpoint?.attributes?.["extra-data"]?.selection;
  if (!Array.isArray(selection)) {
    return "";
  }

  for (const item of selection) {
    const guid = item?.ifc_guid || item?.guid || item?.ifcGuid || item?.objectGuid || "";
    if (guid) {
      return guid;
    }
  }

  return "";
}

function getViewpointCameraState(viewpoint) {
  return viewpoint?.attributes?.["camera-state"] || null;
}

function getViewpointCameraY(viewpoint) {
  const position = getViewpointCameraState(viewpoint)?.position;
  return Array.isArray(position) && typeof position[1] === "number" ? position[1] : null;
}

function getViewpointPlanPoint(viewpoint) {
  const position = getViewpointCameraState(viewpoint)?.position;
  if (!Array.isArray(position) || typeof position[0] !== "number" || typeof position[2] !== "number") {
    return null;
  }

  return {
    x: position[0],
    y: position[2],
  };
}

function getViewpointSpaceIds(viewpoint) {
  return readRelationshipIds(viewpoint, "spaces");
}

function getTopicSpaceIds(topic) {
  return readRelationshipIds(topic, "spaces");
}

function getMapMarkerTopicId(marker) {
  const attrs = marker?.attributes || {};
  const relationships = marker?.relationships || {};

  return String(
    relationships.topic?.data?.id ||
      relationships["parent-topic"]?.data?.id ||
      relationships["parentTopic"]?.data?.id ||
      attrs["topic-id"] ||
      attrs.topicId ||
      attrs["parent-topic-id"] ||
      attrs.parentTopicId ||
      attrs["public-id"] ||
      "",
  );
}

function getMapMarkerPoint(marker) {
  const attrs = marker?.attributes || {};
  const candidates = [attrs.marker, attrs.position, attrs.point, attrs.coordinates];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && typeof candidate[0] === "number" && typeof candidate[1] === "number") {
      return {
        x: candidate[0],
        y: candidate[1],
      };
    }
  }

  if (typeof attrs.x === "number" && typeof attrs.y === "number") {
    return { x: attrs.x, y: attrs.y };
  }

  return null;
}

function sortFloors(floors) {
  return [...floors].sort((left, right) => {
    const leftHeight = Number(left?.height ?? 0);
    const rightHeight = Number(right?.height ?? 0);
    return leftHeight - rightHeight;
  });
}

function findClosestFloorId(cameraY, floors) {
  if (typeof cameraY !== "number" || !Number.isFinite(cameraY) || !floors.length) {
    return "";
  }

  const candidates = [cameraY, -cameraY];
  let bestFloorId = "";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidateY of candidates) {
    for (const floor of floors) {
      const floorHeight = Number(floor?.height);
      if (!Number.isFinite(floorHeight)) {
        continue;
      }

      const distance = Math.abs(floorHeight - candidateY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestFloorId = String(floor.id);
      }
    }
  }

  return bestFloorId;
}

async function loadTopicViewpoints(topicId) {
  const payload = await fetchJsonViaViewer(
    `/project-${state.projectId}/api/v1/v2/topic-viewpoints?page[limit]=20&page[skip]=0&filter[topic]=${encodeURIComponent(topicId)}`,
  );
  return payload.data || [];
}

async function loadTopicMapMarkers(floorId) {
  const cached = state.topicMapMarkersByFloor.get(String(floorId));
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    "filter[isDeleted]": "false",
    "filter[channel]": "workflows",
    "filter[building]": String(state.buildingId || ""),
    "filter[floor]": String(floorId),
    "page[limit]": "5000",
    "page[skip]": "0",
  });

  const payload = await fetchJsonViaViewer(`/project-${state.projectId}/api/v1/v2/map-markers?${params.toString()}`);
  const markers = payload.data || [];
  state.topicMapMarkersByFloor.set(String(floorId), markers);
  appendLog("map-markers laddade", {
    floorId,
    count: markers.length,
    sample: markers.slice(0, 5),
  });
  return markers;
}

async function loadTopicMapEntries(floors) {
  const topics = await loadAllTopics();
  const relevantTopics = topics.filter((topic) => {
    const attrs = topic?.attributes || {};
    return !attrs["is-deleted"] && !attrs["is-draft"] && !isChecklistTopic(topic);
  });

  const entries = [];
  const batchSize = 8;

  for (let index = 0; index < relevantTopics.length; index += batchSize) {
    const batch = relevantTopics.slice(index, index + batchSize);
    const withViewpoints = await Promise.all(
      batch.map(async (topic) => {
        try {
          const viewpoints = await loadTopicViewpoints(topic.id);
          return { topic, viewpoints };
        } catch (error) {
          appendLog("topic-viewpoints fel", {
            topicId: topic.id,
            error: error.message || String(error),
          });
          return { topic, viewpoints: [] };
        }
      }),
    );

    withViewpoints.forEach(({ topic, viewpoints }) => {
      const viewpoint = viewpoints[0] || null;
      const cameraState = getViewpointCameraState(viewpoint);
      const cameraY = getViewpointCameraY(viewpoint);
      const mapPoint = getViewpointPlanPoint(viewpoint);
      const objectGuid = readTopicObjectGuid(topic) || getViewpointSelectionGuid(viewpoint);
      const floorId = findClosestFloorId(cameraY, floors);
      const spaceIds = mergeUniqueStrings(getTopicSpaceIds(topic), getViewpointSpaceIds(viewpoint));

      entries.push({
        id: String(topic.id),
        publicId: getTopicPublicId(topic),
        title: getTopicTitle(topic),
        createdAt: topic?.attributes?.["creation-date"] || "",
        createdLabel: formatDate(topic?.attributes?.["creation-date"] || ""),
        status: getTopicStatusLabel(topic),
        workflow: getTopicWorkflowLabel(topic),
        objectGuid,
        floorId,
        spaceIds,
        cameraY,
        cameraState,
        mapPoint,
        url: buildTopicDetailUrl(topic.id),
      });
    });

    appendLog("arenden bearbetade", {
      processed: Math.min(index + batch.length, relevantTopics.length),
      total: relevantTopics.length,
    });
  }

  return entries.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function buildTopicLookup(entries) {
  state.topicLookupById = new Map();
  state.topicLookupByPublicId = new Map();

  entries.forEach((entry) => {
    state.topicLookupById.set(String(entry.id), entry);
    state.topicLookupByPublicId.set(String(entry.publicId), entry);
  });
}

function mergeFloorEntriesFromMarkers(markers, floor) {
  const entries = [];
  const seen = new Set();

  markers.forEach((marker) => {
    const topicId = getMapMarkerTopicId(marker);
    const topicEntry =
      state.topicLookupById.get(String(topicId || "")) ||
      state.topicLookupByPublicId.get(String(topicId || "")) ||
      null;

    const entry = {
      ...(topicEntry || {}),
      id: String(topicEntry?.id || topicId || marker.id),
      publicId: topicEntry?.publicId || topicId || marker.id,
      title:
        topicEntry?.title ||
        marker?.attributes?.title ||
        marker?.attributes?.name ||
        `Arende ${topicId || marker.id}`,
      createdAt: topicEntry?.createdAt || marker?.attributes?.["creation-date"] || "",
      createdLabel: topicEntry?.createdLabel || formatDate(marker?.attributes?.["creation-date"] || ""),
      status: topicEntry?.status || marker?.attributes?.status || "Open",
      workflow: topicEntry?.workflow || marker?.attributes?.channel || "workflow",
      objectGuid: topicEntry?.objectGuid || "",
      floorId: String(floor.id),
      cameraY: topicEntry?.cameraY || null,
      cameraState: topicEntry?.cameraState || null,
      mapPoint: getMapMarkerPoint(marker) || topicEntry?.mapPoint || null,
      url: topicEntry?.url || buildTopicDetailUrl(topicId || marker.id),
    };

    const dedupeKey = `${entry.id}|${entry.publicId}|${entry.title}`;
    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    entries.push(entry);
  });

  if (entries.length) {
    return entries.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  }

  return state.topicMapEntries
    .filter((entry) => String(entry.floorId) === String(floor.id))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function updateTopicFloorButtons() {
  const floors = state.topicMapFloors;
  const currentIndex = floors.findIndex((floor) => String(floor.id) === String(state.topicMapFloorId));
  const hasSelection = currentIndex !== -1;

  elements.topicFloorSelect.disabled = !floors.length;
  elements.topicFloorPrev.disabled = !hasSelection || currentIndex <= 0;
  elements.topicFloorNext.disabled = !hasSelection || currentIndex >= floors.length - 1;
}

function populateTopicFloorSelect() {
  const floors = state.topicMapFloors;
  elements.topicFloorSelect.innerHTML = "";

  floors.forEach((floor) => {
    const option = document.createElement("option");
    option.value = String(floor.id);
    option.textContent = `${floor.name || `Plan ${floor.id}`} (${Number(floor.height ?? 0).toFixed(2)} m)`;
    elements.topicFloorSelect.appendChild(option);
  });

  if (state.topicMapFloorId) {
    elements.topicFloorSelect.value = String(state.topicMapFloorId);
  }

  updateTopicFloorButtons();
}

function renderTopicMapList(entries, floor) {
  elements.topicMapList.innerHTML = "";
  const unmatched = state.topicMapEntries.filter((entry) => !entry.floorId).length;
  const counts = entries.reduce(
    (bucket, entry) => {
      bucket[getTopicStatusKey(entry.status)] += 1;
      return bucket;
    },
    { open: 0, done: 0, closed: 0, other: 0 },
  );
  elements.topicMapSummary.textContent = `${entries.length} arenden pa ${floor.name || `plan ${floor.id}`}. Open: ${counts.open}, Done: ${counts.done}, Closed: ${counts.closed}.${counts.other ? ` Ovriga: ${counts.other}.` : ""}${unmatched ? ` ${unmatched} arenden kunde inte kopplas till ett plan.` : ""}`;

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<p>Inga arenden hittades pa detta plan.</p>";
    elements.topicMapList.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = `topic-card ${getTopicStatusClass(entry.status)}`;
    card.innerHTML = `
      <h3>${escapeHtml(entry.title)}</h3>
      <div class="topic-card-status">
        <span class="topic-status-chip ${getTopicStatusClass(entry.status)}"><span class="topic-status-dot"></span>${escapeHtml(entry.status)}</span>
      </div>
      <p>Arende ${escapeHtml(entry.publicId)}</p>
      <p>${escapeHtml(entry.workflow)} | Skapad ${escapeHtml(entry.createdLabel)}</p>
      <div class="topic-card-actions">
        <button type="button" data-action="show-topic" data-topic-id="${escapeHtml(entry.id)}">Visa i modellen</button>
        <a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">Oppna arende</a>
      </div>
    `;
    elements.topicMapList.appendChild(card);
  });
}

function renderSpaceTopicList(entries) {
  elements.spaceTopicsList.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<p>Inga arenden hittades i aktuellt space.</p>";
    elements.spaceTopicsList.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = `topic-card ${getTopicStatusClass(entry.status)}`;
    card.innerHTML = `
      <h3>${escapeHtml(entry.title)}</h3>
      <div class="topic-card-status">
        <span class="topic-status-chip ${getTopicStatusClass(entry.status)}"><span class="topic-status-dot"></span>${escapeHtml(entry.status)}</span>
      </div>
      <p>Arende ${escapeHtml(entry.publicId)}</p>
      <p>${escapeHtml(entry.workflow)} | Skapad ${escapeHtml(entry.createdLabel)}</p>
      <div class="topic-card-actions">
        <button type="button" data-action="show-topic" data-topic-id="${escapeHtml(entry.id)}">Visa i modellen</button>
        <a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">Oppna arende</a>
      </div>
    `;
    elements.spaceTopicsList.appendChild(card);
  });
}

async function syncCurrentSpaceTopics() {
  const currentSpaces = state.currentSpaceGuids.filter(Boolean);
  state.currentSpaceFilterReady = false;
  updateOpenSpaceTopicsButton();

  if (!currentSpaces.length) {
    state.currentSpaceRecords = [];
    state.currentSpaceTopicEntries = [];
    elements.spaceTopicsEmpty.classList.remove("hidden");
    elements.spaceTopicsRoot.classList.add("hidden");
    elements.spaceTopicsStatus.textContent = "Inget aktivt space hittades i StreamBIM just nu.";
    elements.spaceTopicsSummary.textContent = "";
    elements.spaceTopicsList.innerHTML = "";
    return;
  }

  if (!state.topicMapEntries.length) {
    elements.spaceTopicsEmpty.classList.add("hidden");
    elements.spaceTopicsRoot.classList.remove("hidden");
    elements.spaceTopicsStatus.textContent = "Laddar projektets arenden for att matcha aktuellt space...";
    elements.spaceTopicsSummary.textContent = "";
    elements.spaceTopicsList.innerHTML = "";
    if (!state.projectId) {
      await loadProjectContext();
    }
    if (!state.workflows.size) {
      await loadWorkflows();
    }
    if (!state.topicMapFloors.length) {
      state.topicMapFloors = sortFloors(await callApi("getFloors"));
    }
    state.topicMapEntries = await loadTopicMapEntries(state.topicMapFloors);
    buildTopicLookup(state.topicMapEntries);
  }

  const entries = state.topicMapEntries.filter((entry) => {
    const spaceIds = Array.isArray(entry.spaceIds) ? entry.spaceIds : [];
    return spaceIds.some((spaceId) => currentSpaces.includes(String(spaceId)));
  });

  appendLog("space-match debug", {
    currentSpaces,
    matchedTopics: entries.length,
    sampleTopics: state.topicMapEntries.slice(0, 8).map((entry) => ({
      id: entry.id,
      publicId: entry.publicId,
      title: entry.title,
      spaceIds: entry.spaceIds || [],
    })),
  });

  state.currentSpaceTopicEntries = entries;
  elements.spaceTopicsEmpty.classList.add("hidden");
  elements.spaceTopicsRoot.classList.remove("hidden");

  const spaceLabels = currentSpaces.map((spaceGuid) => state.currentSpaceNames.get(spaceGuid) || spaceGuid);
  const counts = entries.reduce(
    (bucket, entry) => {
      bucket[getTopicStatusKey(entry.status)] += 1;
      return bucket;
    },
    { open: 0, done: 0, closed: 0, other: 0 },
  );

  elements.spaceTopicsStatus.textContent = `Aktivt space: ${spaceLabels.join(", ")}.`;
  elements.spaceTopicsSummary.textContent = `${entries.length} arenden i aktuellt space. Open: ${counts.open}, Done: ${counts.done}, Closed: ${counts.closed}.${counts.other ? ` Ovriga: ${counts.other}.` : ""}`;
  renderSpaceTopicList(entries);

  try {
    await syncSpaceTopicFilters();
    state.currentSpaceFilterReady = true;
    updateOpenSpaceTopicsButton();
    elements.spaceTopicsStatus.textContent = `Aktivt space: ${spaceLabels.join(", ")}. Filtret ar klart for Topics/2D.`;
    appendLog("space-filter sync", {
      currentSpaces,
      count: currentSpaces.length,
    });
  } catch (error) {
    state.currentSpaceFilterReady = false;
    updateOpenSpaceTopicsButton();
    elements.spaceTopicsStatus.textContent = `Aktivt space: ${spaceLabels.join(", ")}. Rumsfiltret kunde inte synkas for Topics/2D.`;
    appendLog("space-filter sync fel", error.message || String(error));
  }
}

function normalizeSpaceRecord(record) {
  if (!record?.id) {
    return null;
  }

  const attrs = record.attributes || {};
  const relationships = record.relationships || {};

  return {
    id: String(record.id),
    name: String(attrs.name || "").trim(),
    longName: String(attrs["long-name"] || attrs.longName || "").trim(),
    buildingId: String(relationships.building?.data?.id || ""),
    floorId: String(relationships.floor?.data?.id || ""),
    objectId: String(relationships.object?.data?.id || ""),
  };
}

function getSpaceDisplayName(spaceRecord) {
  if (!spaceRecord) {
    return "";
  }

  if (spaceRecord.name && spaceRecord.longName) {
    return `${spaceRecord.name} (${spaceRecord.longName})`;
  }

  return spaceRecord.name || spaceRecord.longName || spaceRecord.id;
}

function collectCameraPositionCandidates(source) {
  const candidates = [];

  const pushCandidate = (value) => {
    if (Array.isArray(value) && value.length >= 3) {
      const [x, y, z] = value.map(Number);
      if ([x, y, z].every((item) => Number.isFinite(item))) {
        candidates.push({ x, y, z });
      }
      return;
    }

    if (value && typeof value === "object") {
      const x = Number(value.x);
      const y = Number(value.y);
      const z = Number(value.z);
      if ([x, y, z].every((item) => Number.isFinite(item))) {
        candidates.push({ x, y, z });
      }
    }
  };

  if (!source || typeof source !== "object") {
    return [];
  }

  [
    source.position,
    source.cameraPosition,
    source.eye,
    source.camera?.position,
    source.camera?.eye,
    source.state?.position,
    source.state?.cameraPosition,
    source.state?.eye,
  ].forEach(pushCandidate);

  return candidates;
}

function expandCameraPositionCandidates(cameraState) {
  const positions = collectCameraPositionCandidates(cameraState);
  const unique = new Map();

  positions.forEach((position) => {
    const variants = [position];
    if (Math.abs(position.y) > 0.0001) {
      variants.push({ x: position.x, y: -position.y, z: position.z });
    }

    variants.forEach((candidate) => {
      const key = [candidate.x.toFixed(3), candidate.y.toFixed(3), candidate.z.toFixed(3)].join("|");
      unique.set(key, candidate);
    });
  });

  return [...unique.values()];
}

async function fetchCurrentSpacesByCamera(cameraState) {
  if (!cameraState || !state.projectId || !state.buildingId) {
    return [];
  }

  const positions = expandCameraPositionCandidates(cameraState);
  appendLog("camera-space lookup", {
    candidates: positions,
  });

  for (const position of positions) {
    const params = new URLSearchParams({
      "filter[building]": String(state.buildingId),
      "filter[x]": position.x.toFixed(3),
      "filter[y]": position.y.toFixed(3),
      "filter[z]": position.z.toFixed(3),
    });

    const payload = await fetchJsonViaViewer(`/project-${state.projectId}/api/v1/v2/ifc-spaces?${params.toString()}`);
    const records = (payload.data || []).map(normalizeSpaceRecord).filter(Boolean);

    appendLog("camera-space svar", {
      position,
      count: records.length,
      spaces: records,
    });

    if (records.length) {
      return records;
    }
  }

  return [];
}

async function fetchSpaceCatalog() {
  if (!state.projectId || !state.buildingId) {
    return [];
  }

  const params = new URLSearchParams({
    "filter[building]": String(state.buildingId),
    "page[limit]": "5000",
    "page[skip]": "0",
  });
  const payload = await fetchJsonViaViewer(`/project-${state.projectId}/api/v1/v2/ifc-spaces?${params.toString()}`);
  return (payload.data || []).map(normalizeSpaceRecord).filter(Boolean);
}

async function resolveCurrentSpaceRecords(spaceIds, cameraState) {
  const cameraMatches = await fetchCurrentSpacesByCamera(cameraState);
  if (cameraMatches.length) {
    return cameraMatches;
  }

  const normalizedSpaceIds = (Array.isArray(spaceIds) ? spaceIds : [])
    .map((spaceId) => String(spaceId || "").trim())
    .filter(Boolean);

  if (!normalizedSpaceIds.length) {
    return [];
  }

  const catalog = await fetchSpaceCatalog();
  const byId = new Map();

  catalog.forEach((record) => {
    byId.set(record.id, record);
    if (record.objectId) {
      byId.set(record.objectId, record);
    }
    if (record.name) {
      byId.set(record.name, record);
    }
  });

  const matches = normalizedSpaceIds.map((spaceId) => byId.get(spaceId)).filter(Boolean);
  appendLog("space catalog fallback", {
    requested: normalizedSpaceIds,
    matches,
  });
  return matches;
}

function applyCurrentSpaceRecords(records, fallbackSpaceIds = []) {
  const normalized = records.map(normalizeSpaceRecord).filter(Boolean);

  state.currentSpaceRecords = normalized;
  state.currentSpaceNames = new Map();

  normalized.forEach((record) => {
    const label = getSpaceDisplayName(record);
    state.currentSpaceNames.set(record.id, label);
    if (record.objectId) {
      state.currentSpaceNames.set(record.objectId, label);
    }
    if (record.name) {
      state.currentSpaceNames.set(record.name, label);
    }
  });

  if (normalized.length) {
    state.currentSpaceGuids = normalized.map((record) => record.id);
    return;
  }

  state.currentSpaceGuids = fallbackSpaceIds
    .map((spaceId) => String(spaceId || "").trim())
    .filter(Boolean);
}

async function refreshCurrentSpaces() {
  if (!state.connected) {
    throw new Error("Widgeten ar inte ansluten till StreamBIM.");
  }

  if (!state.projectId || !state.buildingId) {
    await loadProjectContext();
  }

  let spaces = [];

  try {
    spaces = await callApi("getSpaces");
    appendLog("getSpaces svar", spaces);
  } catch (error) {
    appendLog("getSpaces fel", error.message || String(error));
  }

  try {
    state.currentCameraState = await callApi("getCameraState");
    appendLog("getCameraState svar", state.currentCameraState);
  } catch (error) {
    appendLog("getCameraState fel", error.message || String(error));
  }

  const normalizedSpaceIds = (Array.isArray(spaces) ? spaces : []).map((spaceGuid) => String(spaceGuid || "").trim()).filter(Boolean);
  const records = await resolveCurrentSpaceRecords(normalizedSpaceIds, state.currentCameraState);
  applyCurrentSpaceRecords(records, normalizedSpaceIds);
  await syncCurrentSpaceTopics();
}

async function handleSpacesChanged(guids) {
  appendLog("spacesChanged callback", guids);
  const normalizedSpaceIds = (Array.isArray(guids) ? guids : []).map((spaceGuid) => String(spaceGuid || "").trim()).filter(Boolean);
  const records = await resolveCurrentSpaceRecords(normalizedSpaceIds, state.currentCameraState);
  applyCurrentSpaceRecords(records, normalizedSpaceIds);
  await syncCurrentSpaceTopics();
}

async function fetchTopicFilters() {
  const payload = await fetchJsonViaViewer(`/project-${state.projectId}/api/v1/v2/topic-filters?page[limit]=200&page[skip]=0`);
  return payload.data || [];
}

async function clearWidgetSpaceTopicFilters() {
  const filters = await fetchTopicFilters();
  const widgetFilters = filters.filter((filter) => {
    const attrs = filter?.attributes || {};
    return String(attrs.name || "").startsWith("[Widget space]");
  });

  await Promise.all(
    widgetFilters.map((filter) =>
      callApi("makeApiRequest", {
        url: toAbsoluteViewerUrl(`/project-${state.projectId}/api/v1/v2/topic-filters/${encodeURIComponent(filter.id)}`),
        method: "DELETE",
        accept: "application/vnd.api+json",
        contentType: "application/vnd.api+json",
      }),
    ),
  );
}

async function createSpaceTopicFilter(spaceRecord) {
  const spaceId = String(spaceRecord?.id || "").trim();
  if (!spaceId) {
    return;
  }

  const spaceName = getSpaceDisplayName(spaceRecord);
  const payload = {
    data: {
      type: "topic-filters",
      attributes: {
        name: `[Widget space] ${spaceName}`,
        key: "spaces",
        value: spaceId,
        recordName: spaceName,
        empty: false,
        section: 0,
      },
    },
  };

  await callApi("makeApiRequest", {
    url: toAbsoluteViewerUrl(`/project-${state.projectId}/api/v1/v2/topic-filters`),
    method: "POST",
    accept: "application/vnd.api+json",
    contentType: "application/vnd.api+json",
    body: payload,
  });
}

async function syncSpaceTopicFilters() {
  const currentSpaces = state.currentSpaceRecords.filter((spaceRecord) => spaceRecord?.id);
  if (!state.projectId) {
    await loadProjectContext();
  }

  await clearWidgetSpaceTopicFilters();
  for (const spaceRecord of currentSpaces) {
    await createSpaceTopicFilter(spaceRecord);
  }
}

function openCurrentSpaceTopicsIn2D() {
  const currentSpaces = state.currentSpaceRecords.filter((spaceRecord) => spaceRecord?.id);
  if (!currentSpaces.length) {
    throw new Error("Inget aktivt space hittades att filtrera pa.");
  }

  if (!state.currentSpaceFilterReady) {
    throw new Error("Rumsfiltret ar inte klart an. Klicka pa Uppdatera rum och prova igen.");
  }

  const url = buildTopicsIndexUrl();
  if (!navigateTopWindow(url)) {
    throw new Error("Kunde inte oppna Topics-vyn i StreamBIM.");
  }
}

async function showTopicInModel(entry) {
  if (!entry) {
    return;
  }

  try {
    if (entry.floorId) {
      await callApi("gotoFloor", entry.floorId);
      state.topicMapFloorId = String(entry.floorId);
      elements.topicFloorSelect.value = String(entry.floorId);
      updateTopicFloorButtons();
    }

    if (entry.cameraState) {
      await callApi("setCameraState", entry.cameraState);
    } else if (entry.objectGuid) {
      await callApi("gotoObject", entry.objectGuid);
    }

    if (entry.objectGuid) {
      state.selectedGuid = entry.objectGuid;
      setSelectionState(`Valt objekt: ${entry.objectGuid}`, true);
    }

    elements.actionFeedback.textContent = `Visar arende ${entry.publicId} i modellen.`;
  } catch (error) {
    showError(`Kunde inte visa arendet i modellen: ${error.message || error}`);
  }
}

async function renderTopicMapFloor() {
  const floor = state.topicMapFloors.find((candidate) => String(candidate.id) === String(state.topicMapFloorId));
  if (!floor) {
    elements.topicMapStatus.textContent = "Det finns inget valt plan att visa.";
    return;
  }

  updateTopicFloorButtons();
  elements.topicMapStatus.textContent = `Vaxlar StreamBIM till ${floor.name || `plan ${floor.id}`} och laddar map-markers...`;

  try {
    await callApi("gotoFloor", floor.id);
    elements.actionFeedback.textContent = `StreamBIM flyttades till ${floor.name || `plan ${floor.id}`}.`;
  } catch (error) {
    appendLog("gotoFloor fel", {
      floorId: floor.id,
      error: error.message || String(error),
    });
  }

  await delay(150);

  let entries = [];
  let markerCount = 0;
  try {
    const markers = await loadTopicMapMarkers(floor.id);
    entries = mergeFloorEntriesFromMarkers(markers, floor);
    markerCount = markers.length;
  } catch (error) {
    appendLog("map-markers fel", {
      floorId: floor.id,
      error: error.message || String(error),
    });
    entries = state.topicMapEntries.filter((entry) => String(entry.floorId) === String(floor.id));
  }

  renderTopicMapList(entries, floor);
  elements.topicMapStatus.textContent = `StreamBIM star pa ${floor.name || `plan ${floor.id}`}. Widgeten skickade map-markers-requesten for planet och fick ${markerCount} markorer i svar.`;
}

async function syncTopicMapToActiveFloor(floorId) {
  if (!floorId || !state.topicMapFloors.length) {
    return;
  }

  const normalizedFloorId = String(floorId);
  const existingFloor = state.topicMapFloors.find((candidate) => String(candidate.id) === normalizedFloorId);
  if (!existingFloor) {
    appendLog("aktivt plan saknas i widgeten", {
      floorId: normalizedFloorId,
      knownFloors: state.topicMapFloors.map((floor) => floor.id),
    });
    return;
  }

  state.topicMapFloorId = normalizedFloorId;
  elements.topicFloorSelect.value = normalizedFloorId;

  if (state.topicMapEntries.length) {
    await renderTopicMapFloor();
  } else {
    updateTopicFloorButtons();
  }
}

async function loadTopicMapOverview() {
  elements.topicMapEmpty.classList.add("hidden");
  elements.topicMapRoot.classList.remove("hidden");
  elements.topicMapStatus.textContent = "Laddar projektets arenden och plan...";
  elements.topicMapSummary.textContent = "";
  elements.topicMapList.innerHTML = "";
  state.topicMapMarkersByFloor = new Map();

  if (!state.projectId) {
    await loadProjectContext();
  }
  if (!state.workflows.size) {
    await loadWorkflows();
  }

  const floors = sortFloors(await callApi("getFloors"));
  state.topicMapFloors = floors;
  if (!floors.length) {
    throw new Error("Projektet returnerade inga plan via getFloors().");
  }

  state.topicMapEntries = await loadTopicMapEntries(floors);
  buildTopicLookup(state.topicMapEntries);

  const firstUsefulFloor =
    floors.find((floor) => state.topicMapEntries.some((entry) => String(entry.floorId) === String(floor.id))) ||
    floors[0];

  state.topicMapFloorId = String(firstUsefulFloor.id);
  populateTopicFloorSelect();
  await renderTopicMapFloor();
  if (state.currentSpaceGuids.length) {
    await syncCurrentSpaceTopics();
  }
}

function buildSignatureEntry(topic, comments) {
  const attrs = topic.attributes || {};
  const strings = collectStrings(attrs).concat(comments.map((comment) => comment.attributes?.comment || ""));
  const signatureHits = strings.flatMap((text) => extractSignatureCandidates(String(text)));

  if (!signatureHits.length) {
    return null;
  }

  const workflowId = topic.relationships?.workflow?.data?.id;
  const checklistInstanceId = topic.relationships?.["checklist-item-instance"]?.data?.id || "";
  const createdAt = attrs["creation-date"] || "";

  return {
    topicId: topic.id,
    checklistInstanceId,
    title: attrs.title || attrs["teaser-text"] || `Checklist ${topic.id}`,
    createdAt,
    createdLabel: formatDate(createdAt),
    workflow: state.workflows.get(workflowId) || workflowId || "Okant workflow",
    signatures: [...new Set(signatureHits)],
    url: buildTopicDetailUrl(topic.id),
  };
}

async function loadChecklistCatalog() {
  const limit = 500;
  const allRecords = [];
  let skip = 0;

  while (true) {
    const payload = await fetchJsonViaViewer(
      buildProjectApiUrl(
        `/checklists?page[limit]=${limit}&page[skip]=${skip}&filter[isDraft]=false&filter[skipStatuses]=true`,
      ),
    );

    const chunk = payload.data || [];
    allRecords.push(...chunk);
    appendLog("checklistkatalog sida", {
      skip,
      fetched: chunk.length,
      total: allRecords.length,
      sample: chunk.slice(0, 3),
    });

    if (chunk.length < limit) {
      break;
    }

    skip += limit;
  }

  appendLog("checklistkatalog", {
    count: allRecords.length,
    sample: allRecords.slice(0, 5),
  });

  return allRecords.map((record) => ({
    id: record.id,
    title:
      record.attributes?.title ||
      record.attributes?.name ||
      record.attributes?.["last-name-segment"] ||
      `Checklist ${record.id}`,
    raw: record.attributes || {},
    rawRelationships: record.relationships || {},
  }));
}

async function loadChecklistItems(checklistId) {
  const payload = await fetchJsonViaViewer(
    buildProjectApiUrl(`/checklist-items?page[limit]=1000&page[skip]=0&filter[checklist]=${encodeURIComponent(checklistId)}`),
  );

  appendLog("checklistitems", {
    checklistId,
    count: payload.data?.length || 0,
    sample: payload.data?.slice(0, 5) || [],
  });

  return (payload.data || []).map((record) => ({
    id: record.id,
    title:
      record.attributes?.title ||
      record.attributes?.name ||
      record.attributes?.displayName ||
      record.attributes?.["display-name"] ||
      "",
    name:
      record.attributes?.name ||
      record.attributes?.title ||
      record.attributes?.displayName ||
      record.attributes?.["display-name"] ||
      "",
    inputType:
      record.attributes?.["input-type"] ||
      record.attributes?.inputType ||
      record.attributes?._inputType ||
      "",
    number:
      record.attributes?.number ||
      record.attributes?.index ||
      record.attributes?.order ||
      record.attributes?.position ||
      "",
    raw: record.attributes || {},
  }));
}

function buildIncludedIndex(included = []) {
  const index = new Map();
  for (const record of included) {
    index.set(`${record.type}:${record.id}`, record);
  }
  return index;
}

function getRelationshipData(record, key) {
  return (
    record?.relationships?.[key]?.data ||
    record?.relationships?.[key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)]?.data ||
    null
  );
}

function resolveIncluded(record, key, includedIndex) {
  const relationship = getRelationshipData(record, key);
  if (!relationship || Array.isArray(relationship)) {
    return null;
  }

  return includedIndex.get(`${relationship.type}:${relationship.id}`) || null;
}

function getRelationshipId(record, key) {
  const relationship = getRelationshipData(record, key);
  if (!relationship || Array.isArray(relationship)) {
    return "";
  }

  return relationship.id || "";
}

async function loadChecklistSnapshots(checklistId) {
  const payload = await fetchJsonViaViewer(
    buildProjectApiUrl(
      `/checklist-snapshots?page[limit]=500&page[skip]=0&filter[checklist]=${encodeURIComponent(checklistId)}&filter[includeNotFinalized]=true`,
    ),
  );

  appendLog("checklistsnapshots", {
    checklistId,
    count: payload.data?.length || 0,
    sample: payload.data?.slice(0, 3) || [],
  });

  return payload.data || [];
}

async function loadChecklistItemInstances(checklistId, snapshotId = "") {
  const snapshotFilter = snapshotId
    ? `&filter[checklistSnapshot]=${encodeURIComponent(snapshotId)}`
    : "";
  const payload = await fetchJsonViaViewer(
    buildProjectApiUrl(
      `/checklist-item-instances?page[limit]=1000&page[skip]=0&filter[checklist]=${encodeURIComponent(checklistId)}${snapshotFilter}&include=checklist-item,status,signed-by-user,checklist-snapshot&withDeletedComments=true`,
    ),
  );

  appendLog("checklistiteminstances", {
    checklistId,
    snapshotId: snapshotId || "(ingen snapshot)",
    count: payload.data?.length || 0,
    sample: payload.data?.slice(0, 3) || [],
    included: payload.included?.slice(0, 5) || [],
  });

  if (
    String(checklistId) === TARGET_SIGNATURE_DEBUG.checklistId &&
    String(snapshotId || "") === TARGET_SIGNATURE_DEBUG.snapshotId
  ) {
    const targetRecord = (payload.data || []).find((record) => String(record?.id || "") === TARGET_SIGNATURE_DEBUG.itemInstanceId);
    appendLog("target signaturpost api", {
      checklistId,
      snapshotId,
      found: Boolean(targetRecord),
      targetRecord: targetRecord || null,
    });
  }

  return payload;
}

function itemLooksLikeSignature(item) {
  const title = pickFirstDefined(item?.title, item?.name, item?.label);
  const inputType = `${pickFirstDefined(item?.inputType, item?._inputType, item?.type)}`.toLowerCase();
  if (inputType === "signature") {
    return true;
  }
  return (
    looksLikeSignatureField([title, item?.name, item?.label, item?.number, item?.raw]) ||
    looksLikeSignatureField([title, item?.name, item?.label, item?.number, item?.raw, "signature"])
  );
}

function extractSignatureNames(item) {
  const inputType = `${pickFirstDefined(item?.inputType, item?._inputType, item?.type)}`.toLowerCase();
  if (inputType === "signature") {
    const signatureOnly = collectSignatureValues([
      item?.signedByUser?.name,
      item?.signedByUser?._name,
      item?.signedByUser?.fullName,
      item?.signedByUser?.email,
      item?.signedByUser,
      item?.options,
      item?.optionText,
      item?.optionValue,
      item?.displayValue,
    ]);

    if (signatureOnly.length) {
      return signatureOnly;
    }
  }

  const direct = collectSignatureValues([
    item?.signedByUser?.name,
    item?.signedByUser?._name,
    item?.signedByUser?.fullName,
    item?.signedByUser?.email,
    item?.signedByUser,
    item?.value,
    item?.displayValue,
    item?.optionValue,
    item?.optionText,
    item?.options,
    item?.otherValue,
    item?.checklistItemInstance?.signedByUser,
    item?.checklistItemInstance?.options,
  ]);

  if (direct.length) {
    return direct;
  }

  return collectSignatureValues(item);
}

function parseChecklistItemInstance(instance, includedIndex) {
  const attrs = instance?.attributes || {};
  const checklistItem = resolveIncluded(instance, "checklist-item", includedIndex);
  const checklistItemAttrs = checklistItem?.attributes || {};
  const statusRecord = resolveIncluded(instance, "status", includedIndex);
  const signedByUser = resolveIncluded(instance, "signed-by-user", includedIndex);
  const snapshotRecord = resolveIncluded(instance, "checklist-snapshot", includedIndex);
  const snapshotAttrs = snapshotRecord?.attributes || {};
  const checklistItemId = getRelationshipId(instance, "checklist-item");
  const statusId = getRelationshipId(instance, "status");
  const signedByUserId = getRelationshipId(instance, "signed-by-user");
  const snapshotId = getRelationshipId(instance, "checklist-snapshot");
  const objectId = pickFirstDefined(
    getRelationshipId(instance, "object"),
    attrs.object,
    attrs["object-id"],
    attrs.objectId,
  );

  return {
    id: instance.id,
    title: pickFirstDefined(
      checklistItemAttrs.title,
      checklistItemAttrs.name,
      checklistItemAttrs.displayName,
      checklistItemAttrs["display-name"],
      attrs.title,
      attrs.name,
      attrs.label,
    ),
    inputType: pickFirstDefined(
      checklistItemAttrs["input-type"],
      checklistItemAttrs.inputType,
      checklistItemAttrs._inputType,
      attrs["input-type"],
      attrs.inputType,
      attrs._inputType,
    ),
    status: pickFirstDefined(
      statusRecord?.attributes?.name,
      statusId,
      statusRecord?.id,
      attrs.status,
      attrs["status-name"],
    ),
    signedByUser: pickFirstDefined(
      signedByUser?.attributes?.name,
      signedByUser?.attributes?.fullName,
      signedByUser?.attributes?.email,
      signedByUserId,
      attrs["signed-by-user"],
      attrs.signedByUser,
    ),
    value: pickFirstDefined(
      attrs.value,
      attrs.options,
      attrs.optionValue,
      attrs.optionText,
      attrs.otherValue,
      attrs.displayValue,
    ),
    createdAt: pickFirstDefined(
      attrs["creation-date"],
      attrs.createdAt,
      snapshotAttrs["start-date"],
      snapshotAttrs.startDate,
      snapshotAttrs["creation-date"],
    ),
    snapshotId: snapshotRecord?.id || snapshotId || "",
    snapshotLabel: pickFirstDefined(
      snapshotAttrs.name,
      snapshotAttrs.title,
      snapshotAttrs["start-date"],
      snapshotAttrs.startDate,
    ),
    number: pickFirstDefined(
      checklistItemAttrs.number,
      checklistItemAttrs.index,
      checklistItemAttrs.order,
      attrs.number,
      attrs.index,
      attrs.order,
    ),
    raw: {
      checklistItem: checklistItemAttrs,
      instance: attrs,
    },
    checklistItemId,
    objectId,
  };
}

function buildChecklistItemLookup(items) {
  const lookup = new Map();
  for (const item of items) {
    lookup.set(String(item.id), item);
  }
  return lookup;
}

function mergeChecklistItemData(instanceItem, checklistItemLookup) {
  const definition = checklistItemLookup.get(String(instanceItem.checklistItemId || ""));
  if (!definition) {
    return instanceItem;
  }

  return {
    ...instanceItem,
    title: pickFirstDefined(instanceItem.title, definition.title, definition.name),
    name: pickFirstDefined(instanceItem.name, definition.name, definition.title),
    inputType: pickFirstDefined(instanceItem.inputType, definition.inputType),
    number: pickFirstDefined(instanceItem.number, definition.number),
    raw: {
      definition: definition.raw || {},
      ...(instanceItem.raw || {}),
    },
  };
}

function inferChecklistClassification(checklist, checklistItems, item) {
  const checklistRaw = checklist?.raw || {};
  const rawFlags = [
    checklistRaw.groupBy,
    checklistRaw["group-by"],
    checklistRaw.onWagon,
    checklistRaw["on-wagon"],
    checklistRaw.handoverFor,
    checklistRaw["handover-for"],
    checklistRaw.objectProperty,
    checklistRaw["object-property"],
  ]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);

  const hasItemObjectProperty = checklistItems.some((checklistItem) =>
    Boolean(
      normalizeWhitespace(
        checklistItem?.raw?.["object-property"] ||
          checklistItem?.raw?.objectProperty ||
          "",
      ),
    ),
  );

  if (rawFlags.length || hasItemObjectProperty) {
    return "Objektbunden checklista";
  }

  if (item?.objectId) {
    return "Fristaende checklista";
  }

  return "Fristaende checklista";
}

function buildInstanceSignatureEntries(checklist, records, includedIndex, checklistItemLookup, checklistItems) {
  const entries = [];
  const groups = new Map();
  const matchedItems = [];

  for (const record of records) {
    const item = mergeChecklistItemData(parseChecklistItemInstance(record, includedIndex), checklistItemLookup);
    const isTargetRecord =
      String(checklist.id) === TARGET_SIGNATURE_DEBUG.checklistId &&
      String(item.snapshotId || "") === TARGET_SIGNATURE_DEBUG.snapshotId &&
      String(item.id || "") === TARGET_SIGNATURE_DEBUG.itemInstanceId;

    if (isTargetRecord) {
      appendLog("target signaturpost tolkad", {
        checklistId: checklist.id,
        parsedItem: item,
        looksLikeSignature: itemLooksLikeSignature(item),
        isDoneStatus: isDoneStatus(item.status),
        signatures: extractSignatureNames(item),
      });
    }

    if (!itemLooksLikeSignature(item)) {
      if (isTargetRecord) {
        appendLog("target signaturpost bortfiltrerad", {
          reason: "itemLooksLikeSignature=false",
          checklistId: checklist.id,
          item,
        });
      }
      continue;
    }

    matchedItems.push(item);

    if (!isDoneStatus(item.status) && !item.signedByUser) {
      if (isTargetRecord) {
        appendLog("target signaturpost bortfiltrerad", {
          reason: "varken done-status eller signedByUser",
          checklistId: checklist.id,
          item,
        });
      }
      continue;
    }

    const signatures = uniqueStrings(extractSignatureNames(item));
    if (!signatures.length) {
      appendLog("signaturinstans utan namn", {
        checklistId: checklist.id,
        item,
        record,
      });
      continue;
    }

    const groupKey = [checklist.id, item.objectId || "", item.snapshotId || "", item.id].join("|");
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        topicId: "",
        checklistInstanceId: item.id,
        title: checklist.title || `Checklista ${checklist.id}`,
        signatureLabel: pickFirstDefined(item.name, item.title, "Signatur"),
        checklistTitle: checklist.title || `Checklista ${checklist.id}`,
        checklistClassification: inferChecklistClassification(checklist, checklistItems, item),
        createdAt: item.createdAt,
        createdLabel: formatDate(item.createdAt),
        workflow: "Checklist-instans",
        signatures: [],
        url: buildChecklistItemUrl(checklist.id, item.objectId, item.id, item.snapshotId),
        objectId: item.objectId,
        itemId: item.id,
        snapshotId: item.snapshotId,
        matchedItem: item,
      });
    }

    const group = groups.get(groupKey);
    group.signatures.push(...signatures);
    if (!group.createdAt && item.createdAt) {
      group.createdAt = item.createdAt;
      group.createdLabel = formatDate(item.createdAt);
    }
    group.url = buildChecklistItemUrl(checklist.id, item.objectId, item.id, item.snapshotId);
  }

  if (!matchedItems.length && records.length) {
    appendLog("inga matchande instansitems", {
      checklistId: checklist.id,
      sampleParsedItems: records.slice(0, 8).map((record) =>
        mergeChecklistItemData(parseChecklistItemInstance(record, includedIndex), checklistItemLookup),
      ),
    });
  }

  for (const entry of groups.values()) {
    entry.signatures = uniqueStrings(entry.signatures);
    entries.push(entry);
  }

  if (String(checklist.id) === TARGET_SIGNATURE_DEBUG.checklistId) {
    const targetEntry = entries.find((entry) => String(entry.itemId || "") === TARGET_SIGNATURE_DEBUG.itemInstanceId);
    if (targetEntry) {
      appendLog("target signaturpost sammanstallning", targetEntry);
    }
  }

  return entries;
}

function mergeChecklistInstancePayloads(payloads) {
  const records = [];
  const included = [];
  const seenRecords = new Set();
  const seenIncluded = new Set();

  payloads.forEach((payload) => {
    (payload?.data || []).forEach((record) => {
      const key = `${record?.type || ""}:${record?.id || ""}`;
      if (seenRecords.has(key)) {
        return;
      }
      seenRecords.add(key);
      records.push(record);
    });

    (payload?.included || []).forEach((record) => {
      const key = `${record?.type || ""}:${record?.id || ""}`;
      if (seenIncluded.has(key)) {
        return;
      }
      seenIncluded.add(key);
      included.push(record);
    });
  });

  return { data: records, included };
}

async function loadSignatureEntriesFromChecklistInstances() {
  const checklistCatalog = await loadChecklistCatalog();
  const entries = [];

  for (const checklist of checklistCatalog) {
    const checklistId = checklist.id;
    const checklistTitle = checklist.title || `Checklist ${checklistId}`;
    elements.checklistStatus.textContent = `Soker signaturer i ${checklistTitle}...`;

    let checklistItems = [];
    try {
      checklistItems = await loadChecklistItems(checklistId);
    } catch (error) {
      appendLog("checklistitems fel", {
        checklistId,
        message: error.message || String(error),
      });
      continue;
    }
    const checklistItemLookup = buildChecklistItemLookup(checklistItems);

    try {
      const snapshots = await loadChecklistSnapshots(checklistId);
      const snapshotIds = snapshots.map((snapshot) => snapshot.id);
      let checklistEntryCountBefore = entries.length;
      const payloads = [];
      payloads.push(await loadChecklistItemInstances(checklistId));
      for (const snapshotId of snapshotIds) {
        payloads.push(await loadChecklistItemInstances(checklistId, snapshotId));
      }

      const mergedPayload = mergeChecklistInstancePayloads(payloads);
      appendLog("sammanfogade checklistinstanser", {
        checklistId,
        checklistTitle,
        snapshotIds,
        mergedCount: mergedPayload.data.length,
      });

      const includedIndex = buildIncludedIndex(mergedPayload.included || []);
      entries.push(
        ...buildInstanceSignatureEntries(
          {
            id: checklistId,
            title: checklistTitle,
            raw: checklist.raw,
            rawRelationships: checklist.rawRelationships,
          },
          mergedPayload.data || [],
          includedIndex,
          checklistItemLookup,
          checklistItems,
        ),
      );

      if (entries.length > checklistEntryCountBefore) {
        appendLog("signaturchecklista hittad", {
          checklistId,
          checklistTitle,
          foundEntries: entries.slice(checklistEntryCountBefore),
        });
      } else {
        appendLog("ingen signaturinstans i checklista", {
          checklistId,
          checklistTitle,
          snapshots: snapshotIds,
        });
      }
    } catch (error) {
      appendLog("checklistinstanser fel", {
        checklistId,
        message: error.message || String(error),
      });
    }
  }

  return entries;
}

function renderSignatureOverview(entries) {
  elements.checklistStatus.textContent = "Laddar checklistor...";
  elements.checklistEmpty.classList.add("hidden");
  elements.checklistRoot.classList.add("hidden");
  elements.checklistRoot.innerHTML = "";

  const summary = document.createElement("section");
  summary.className = "checklist-summary";
  const signatureCount = entries.reduce((sum, entry) => sum + entry.signatures.length, 0);
  [
    { value: entries.length, label: "signaturposter hittade" },
    { value: signatureCount, label: "signaturvarder hittade" },
    { value: entries[0]?.createdLabel || "-", label: "senaste skapad" },
  ].forEach((item) => {
    const tile = document.createElement("article");
    tile.className = "summary-tile";
    tile.innerHTML = `<strong>${item.value}</strong><span>${item.label}</span>`;
    summary.appendChild(tile);
  });
  elements.checklistRoot.appendChild(summary);

  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "checklist-card";

    const header = document.createElement("div");
    header.className = "checklist-header";

    const titleLink = document.createElement("a");
    titleLink.className = "checklist-title-link";
    titleLink.href = entry.url;
    titleLink.target = "_blank";
    titleLink.rel = "noreferrer";
    titleLink.innerHTML = `<h3>${entry.title}</h3>`;
    header.appendChild(titleLink);

    const meta = document.createElement("div");
    meta.className = "checklist-meta";
    [
      `Skapad ${entry.createdLabel}`,
      entry.workflow,
      entry.checklistClassification,
      entry.objectId ? `Objektreferens ${entry.objectId}` : "Ingen objektreferens",
      entry.checklistInstanceId ? `Checklist ${entry.checklistInstanceId}` : `Topic ${entry.topicId}`,
    ]
      .filter(Boolean)
      .forEach((text) => {
        const chip = document.createElement("span");
        chip.className = "meta-chip";
        chip.textContent = text;
        meta.appendChild(chip);
      });
    header.appendChild(meta);
    card.appendChild(header);

    entry.signatures.forEach((signature) => {
      const signatureBlock = document.createElement("div");
      signatureBlock.className = "signature-block";

      const label = document.createElement("span");
      label.className = "signature-label";
      label.textContent = entry.signatureLabel || "Signatur";
      signatureBlock.appendChild(label);

      const link = document.createElement("a");
      link.className = "signature-link";
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = signature;
      signatureBlock.appendChild(link);

      card.appendChild(signatureBlock);
    });

    const footer = document.createElement("div");
    footer.className = "checklist-footer";
    const helper = document.createElement("span");
    helper.className = "helper-text";
    helper.textContent = "Klicka pa signaturen eller checklistans namn for att oppna posten direkt i StreamBIM.";
    footer.appendChild(helper);

    const openLink = document.createElement("a");
    openLink.href = entry.url;
    openLink.target = "_blank";
    openLink.rel = "noreferrer";
    openLink.textContent = "Oppna i StreamBIM";
    footer.appendChild(openLink);
    card.appendChild(footer);

    elements.checklistRoot.appendChild(card);
  });

  elements.checklistRoot.classList.remove("hidden");
  elements.checklistStatus.textContent = `Hittade ${entries.length} ifyllda signaturposter i projektet.`;
  elements.exportPdf.disabled = !entries.length;
}

function openPdfReport() {
  if (!state.signatureEntries.length) {
    return;
  }

  const rows = state.signatureEntries
    .map(
      (entry) => `
        <tr>
          <td>${entry.title}</td>
          <td>${entry.createdLabel}</td>
          <td>${entry.signatures.join("<br/>")}</td>
          <td><a href="${entry.url}">${entry.url}</a></td>
        </tr>`,
    )
    .join("");

  const reportWindow = window.open("", "_blank", "width=1100,height=800");
  if (!reportWindow) {
    showError("Webblasaren blockerade rapportfonstret.");
    return;
  }

  reportWindow.document.write(`<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <title>Signaturrapport - StreamBIM</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 32px; color: #1f1a14; }
      h1 { margin: 0 0 8px; }
      p { margin: 0 0 18px; color: #5b5247; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px 12px; border: 1px solid #d9cfbf; text-align: left; vertical-align: top; }
      th { background: #f6eee4; }
      a { color: #a84b1a; word-break: break-all; }
    </style>
  </head>
  <body>
    <h1>Signaturrapport</h1>
    <p>Projekt ${state.projectId} | Genererad ${formatDate(new Date().toISOString())} | Endast ifyllda signaturposter.</p>
    <table>
      <thead>
        <tr>
          <th>Checklista</th>
          <th>Skapad</th>
          <th>Signatur</th>
          <th>Lank</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

async function loadSignatureOverview() {
  elements.checklistStatus.textContent = "Laddar signaturoversikt...";
  elements.checklistEmpty.classList.add("hidden");
  elements.checklistRoot.classList.add("hidden");
  elements.checklistRoot.innerHTML = "";
  elements.exportPdf.disabled = true;
  appendLog("Signaturoversikt", "Startar automatisk laddning av checklistsignaturer.");

  try {
    if (!state.projectId) {
      await loadProjectContext();
    }
    if (!state.workflows.size) {
      await loadWorkflows();
    }

      const entries = await loadSignatureEntriesFromChecklistInstances();
      appendLog("signaturer via checklistinstanser", { count: entries.length });

    entries.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    state.signatureEntries = entries.filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.url === entry.url &&
            candidate.createdAt === entry.createdAt &&
            candidate.signatures.join("|") === entry.signatures.join("|"),
        ) === index,
    );

    if (!state.signatureEntries.length) {
      elements.checklistEmpty.classList.remove("hidden");
      elements.checklistStatus.textContent =
        "Jag hittade inga ifyllda signaturposter i de checklistinstanser som kunde lasas i projektet.";
      appendLog("Signaturoversikt", "Inga ifyllda signaturposter hittades.");
      return;
    }

    renderSignatureOverview(state.signatureEntries);
  } catch (error) {
    state.signatureEntries = [];
    elements.checklistEmpty.classList.remove("hidden");
    elements.checklistRoot.classList.add("hidden");
    showError(`Kunde inte lasa signaturoversikten: ${error.message || error}`);
    elements.checklistStatus.textContent =
      "Signaturoversikten misslyckades. Se debug-loggen for exakt API-svar.";
  }
}

async function initializeProjectData() {
  try {
    await loadProjectContext();
  } catch (error) {
    appendLog("Projektinfo", `Projektinfo kunde inte laddas initialt: ${error.message || error}`);
  }

  try {
    await loadTopicMapOverview();
  } catch (error) {
    appendLog("2D arendekarta", `Autoladdning misslyckades: ${error.message || error}`);
    elements.topicMapEmpty.classList.remove("hidden");
    elements.topicMapRoot.classList.add("hidden");
    elements.topicMapStatus.textContent =
      "2D-kartan kunde inte laddas automatiskt. Se debug-loggen och prova igen med knappen.";
  }

  try {
    await refreshCurrentSpaces();
  } catch (error) {
    appendLog("Space-arenden", `Autoladdning misslyckades: ${error.message || error}`);
    elements.spaceTopicsEmpty.classList.remove("hidden");
    elements.spaceTopicsRoot.classList.add("hidden");
    elements.spaceTopicsStatus.textContent =
      "Kunde inte lasa aktivt space automatiskt. Prova knappen Uppdatera rum eller ga in i ett rum i modellen.";
  }
}

async function handlePickedObject(result) {
  appendLog("pickedObject callback", result);

  const guid = extractGuid(result);
  if (!guid) {
    showError("pickedObject anropades men ingen GUID hittades i payloaden.");
    return;
  }

  state.selectedGuid = guid;
  setSelectionState(`Valt objekt: ${guid}`, true);
  elements.actionFeedback.textContent = "Laddar objektinformation...";

  try {
    const info = await callApi("getObjectInfo", guid);
    appendLog("getObjectInfo svar", info || { guid });
    renderObjectInfo(info || { guid });
    elements.actionFeedback.textContent = "Objektets data hamtades fran StreamBIM.";
  } catch (error) {
    renderObjectInfo({ guid, description: "Objektet valdes men egenskaper kunde inte hamtas." });
    showError(`Kunde inte lasa objektinfo for ${guid}: ${error.message || error}`);
  }
}

async function connectWidget() {
  try {
    await ensureStreamBimLibrary();

    const callbacks = {
      pickedObject: handlePickedObject,
      spacesChanged: async (guids) => {
        try {
          await handleSpacesChanged(guids);
        } catch (error) {
          appendLog("spacesChanged fel", error.message || String(error));
        }
      },
      floorChanged: async (floorId) => {
        appendLog("floorChanged callback", floorId);
        await syncTopicMapToActiveFloor(floorId);
      },
      cameraChanged: (cameraState) => {
        state.currentCameraState = cameraState;
        appendLog("cameraChanged callback", cameraState);
      },
      beforeInit: () => appendLog("beforeInit callback", "Viewer initierar"),
    };

    appendLog("Anslutning startar", {
      hasConnectToParent: typeof StreamBIM.connectToParent === "function",
      hasLegacyConnect: typeof StreamBIM.connect === "function",
      hasApi: Boolean(StreamBIM.API),
      topLevelMethods: [
        "getProjectId",
        "getUserEmail",
        "getObjectInfo",
        "gotoObject",
        "highlightObject",
      ].filter((name) => typeof StreamBIM[name] === "function"),
    });

    if (typeof StreamBIM.connectToParent === "function") {
      let connected = false;
      const connectTargets = [window.parent, window].filter(Boolean);

      for (const target of connectTargets) {
        try {
          await StreamBIM.connectToParent(target, callbacks);
          appendLog("Anslutning", `Anvande StreamBIM.connectToParent(${target === window.parent ? "window.parent" : "window"}, callbacks)`);
          connected = true;
          break;
        } catch (error) {
          appendLog("connectToParent fel", {
            target: target === window.parent ? "window.parent" : "window",
            message: error.message || String(error),
          });
        }
      }

      if (!connected) {
        throw new Error("connectToParent misslyckades mot bade window.parent och window.");
      }
    } else if (typeof StreamBIM.connect === "function") {
      await StreamBIM.connect(callbacks);
      appendLog("Anslutning", "Anvande legacy StreamBIM.connect(callbacks)");
    } else {
      throw new Error("Ingen connect-metod hittades pa StreamBIM-objektet.");
    }

    setConnectionState(true, "Ansluten till StreamBIM");
    setSelectionState("Klicka pa ett objekt i modellen", false);
    elements.actionFeedback.textContent = "Widgeten ar ansluten och lyssnar nu pa objektklick.";
    appendLog("Anslutning klar", "Widgeten ar nu kopplad till parent.");
    appendLog("Autoladdning", "Laddar projektdata och uppdaterar aktuellt space efter anslutning.");
    await initializeProjectData();
  } catch (error) {
    setConnectionState(false, "Anslutning misslyckades");
    showError(`Kunde inte ansluta till StreamBIM: ${error.message || error}`);
  }
}

window.addEventListener("message", (event) => {
  appendLog("window.message", {
    origin: event.origin,
    data: event.data,
  });
});

elements.refreshContext.addEventListener("click", async () => {
  elements.actionFeedback.textContent = "Laddar om projektinformation...";
  appendLog("Manuell handling", "Laddar om projektinformation");
  await loadProjectContext();
});

elements.gotoObject.addEventListener("click", async () => {
  if (!state.selectedGuid) {
    return;
  }

  try {
    await callApi("gotoObject", state.selectedGuid);
    appendLog("gotoObject", state.selectedGuid);
    elements.actionFeedback.textContent = `Kameran flyttades till ${state.selectedGuid}.`;
  } catch (error) {
    showError(`Kunde inte navigera till objektet: ${error.message || error}`);
  }
});

elements.highlightObject.addEventListener("click", async () => {
  if (!state.selectedGuid) {
    return;
  }

  try {
    await callApi("highlightObject", state.selectedGuid);
    appendLog("highlightObject", state.selectedGuid);
    elements.actionFeedback.textContent = `Objektet ${state.selectedGuid} markerades i modellen.`;
  } catch (error) {
    showError(`Kunde inte markera objektet: ${error.message || error}`);
  }
});

elements.copyGuid.addEventListener("click", async () => {
  if (!state.selectedGuid) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.selectedGuid);
    appendLog("clipboard.writeText", state.selectedGuid);
    elements.actionFeedback.textContent = `GUID kopierades: ${state.selectedGuid}.`;
  } catch (error) {
    showError(`Kunde inte kopiera GUID: ${error.message || error}`);
  }
});

elements.loadChecklists.addEventListener("click", async () => {
  appendLog("Manuell handling", "Hamta signaturoversikt");
  await loadSignatureOverview();
});

elements.exportPdf.addEventListener("click", () => {
  appendLog("Manuell handling", "Skapa PDF-rapport");
  openPdfReport();
});

elements.loadTopicMap.addEventListener("click", async () => {
  appendLog("Manuell handling", "Ladda 2D arendekarta");
  try {
    if (!state.connected) {
      appendLog("2D arendekarta", "Widgeten var inte ansluten, provar att ansluta innan laddning.");
      await connectWidget();
    }

    if (!state.connected) {
      throw new Error("Widgeten ar fortfarande inte ansluten till StreamBIM.");
    }

    await loadTopicMapOverview();
    elements.actionFeedback.textContent = "Arenden laddades i widgeten utan att lamna StreamBIM-vyn.";
  } catch (error) {
    showError(`Kunde inte ladda 2D arendekartan: ${error.message || error}`);
  }
});

elements.refreshSpaceTopics.addEventListener("click", async () => {
  appendLog("Manuell handling", "Ladda arenden i aktuellt space");

  try {
    if (!state.connected) {
      appendLog("Space-arenden", "Widgeten var inte ansluten, provar att ansluta innan uppdatering.");
      await connectWidget();
    }

    if (!state.connected) {
      throw new Error("Widgeten ar fortfarande inte ansluten till StreamBIM.");
    }

    await refreshCurrentSpaces();
    elements.actionFeedback.textContent = "Arenden for aktuellt space laddades.";
  } catch (error) {
    showError(`Kunde inte lasa arenden i aktuellt space: ${error.message || error}`);
  }
});

elements.openSpaceTopics.addEventListener("click", () => {
  appendLog("Manuell handling", "Oppna Topics med aktivt space-filter");

  try {
    if (!state.connected) {
      throw new Error("Widgeten ar inte ansluten till StreamBIM.");
    }

    openCurrentSpaceTopicsIn2D();
  } catch (error) {
    showError(`Kunde inte oppna 2D-kartan for aktuellt space: ${error.message || error}`);
  }
});

elements.topicFloorSelect.addEventListener("change", async (event) => {
  state.topicMapFloorId = String(event.target.value || "");
  await renderTopicMapFloor();
});

elements.topicFloorPrev.addEventListener("click", async () => {
  const currentIndex = state.topicMapFloors.findIndex((floor) => String(floor.id) === String(state.topicMapFloorId));
  if (currentIndex <= 0) {
    return;
  }

  state.topicMapFloorId = String(state.topicMapFloors[currentIndex - 1].id);
  elements.topicFloorSelect.value = state.topicMapFloorId;
  await renderTopicMapFloor();
});

elements.topicFloorNext.addEventListener("click", async () => {
  const currentIndex = state.topicMapFloors.findIndex((floor) => String(floor.id) === String(state.topicMapFloorId));
  if (currentIndex === -1 || currentIndex >= state.topicMapFloors.length - 1) {
    return;
  }

  state.topicMapFloorId = String(state.topicMapFloors[currentIndex + 1].id);
  elements.topicFloorSelect.value = state.topicMapFloorId;
  await renderTopicMapFloor();
});

elements.topicMapList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='show-topic']");
  if (!button) {
    return;
  }

  const entry = state.topicMapEntries.find((candidate) => candidate.id === String(button.dataset.topicId || ""));
  await showTopicInModel(entry);
});

elements.spaceTopicsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='show-topic']");
  if (!button) {
    return;
  }

  const entry = state.currentSpaceTopicEntries.find((candidate) => candidate.id === String(button.dataset.topicId || ""));
  await showTopicInModel(entry);
});

elements.clearLog.addEventListener("click", () => {
  elements.debugLog.innerHTML = "";
});

connectWidget();
