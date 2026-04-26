const state = {
  connected: false,
  selectedGuid: "",
  selectedInfo: null,
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

    elements.projectId.textContent = formatValue(projectId);
    elements.buildingId.textContent = formatValue(buildingId);
    elements.userEmail.textContent = formatValue(userEmail);
  } catch (error) {
    showError(`Kunde inte lasa projektinfo: ${error.message || error}`);
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
    await loadProjectContext();
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

elements.clearLog.addEventListener("click", () => {
  elements.debugLog.innerHTML = "";
});

connectWidget();
