const state = {
  connected: false,
  selectedGuid: "",
  selectedInfo: null,
  projectId: "",
  buildingId: "",
  userEmail: "",
  workflows: new Map(),
  signatureEntries: [],
};

const STREAMBIM_SCRIPT_CANDIDATES = [
  "https://cdn.jsdelivr.net/npm/streambim-widget-api@2.0.1/dist/streambim-widget-api.min.js",
  "https://unpkg.com/streambim-widget-api@2.0.1/dist/streambim-widget-api.min.js",
  "https://cdn.jsdelivr.net/gh/streambim/streambim-widget-api@master/dist/streambim-widget-api.min.js",
];

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

async function fetchJsonViaViewer(url, method = "GET", body = undefined) {
  const request = {
    url,
    method,
    accept: "application/vnd.api+json",
    contentType: "application/vnd.api+json",
  };

  if (body !== undefined) {
    request.body = body;
  }

  const raw = await callApi("makeApiRequest", request);
  appendLog("makeApiRequest svar", { url, raw: typeof raw === "string" ? raw.slice(0, 1000) : raw });
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

function renderSignatureOverview(entries) {
  elements.checklistStatus.textContent = "Laddar checklistor...";
  elements.checklistEmpty.classList.add("hidden");
  elements.checklistRoot.classList.add("hidden");
  elements.checklistRoot.innerHTML = "";

  const summary = document.createElement("section");
  summary.className = "checklist-summary";
  const signatureCount = entries.reduce((sum, entry) => sum + entry.signatures.length, 0);
  [
    { value: entries.length, label: "checklistor med 33. Signatur" },
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
    [`Skapad ${entry.createdLabel}`, entry.workflow, entry.checklistInstanceId ? `Checklist ${entry.checklistInstanceId}` : `Topic ${entry.topicId}`]
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
      label.textContent = "33. Signatur";
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
  elements.checklistStatus.textContent = `Hittade ${entries.length} checklistor som innehaller faltet 33. Signatur.`;
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
    <p>Projekt ${state.projectId} | Genererad ${formatDate(new Date().toISOString())} | Endast checklistor som innehaller 33. Signatur.</p>
    <table>
      <thead>
        <tr>
          <th>Checklista</th>
          <th>Skapad</th>
          <th>33. Signatur</th>
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

    const topics = await loadAllTopics();
    const checklistTopics = topics.filter(isChecklistTopic);
    appendLog("checklisttopics", { totalTopics: topics.length, checklistTopics: checklistTopics.length });

    const entries = [];
    for (const topic of checklistTopics) {
      const comments = await loadTopicComments(topic.id);
      const entry = buildSignatureEntry(topic, comments);
      if (entry) {
        entries.push(entry);
      }
    }

    entries.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    state.signatureEntries = entries;

    if (!entries.length) {
      elements.checklistEmpty.classList.remove("hidden");
      elements.checklistStatus.textContent =
        "Jag hittade inga checklistinstanser med 33. Signatur i de checklistposter som kunde lasas i projektet.";
      appendLog("Signaturoversikt", "Inga checklistinstanser med 33. Signatur hittades.");
      return;
    }

    renderSignatureOverview(entries);
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
    await loadSignatureOverview();
  } catch (error) {
    appendLog("Signaturoversikt", `Autoladdning misslyckades: ${error.message || error}`);
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
      spacesChanged: (guids) => appendLog("spacesChanged callback", guids),
      floorChanged: (floorId) => appendLog("floorChanged callback", floorId),
      cameraChanged: (cameraState) => appendLog("cameraChanged callback", cameraState),
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
      await StreamBIM.connectToParent(window, callbacks);
      appendLog("Anslutning", "Anvande StreamBIM.connectToParent(window, callbacks)");
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
    appendLog("Autoladdning", "Laddar projektdata och signaturoversikt automatiskt efter anslutning.");
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

elements.clearLog.addEventListener("click", () => {
  elements.debugLog.innerHTML = "";
});

connectWidget();
