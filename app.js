const state = {
  connected: false,
  selectedGuid: "",
  selectedInfo: null,
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
};

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
}

async function loadProjectContext() {
  if (!state.connected) {
    return;
  }

  try {
    const [projectId, buildingId, userEmail] = await Promise.all([
      StreamBIM.API.getProjectId(),
      StreamBIM.API.getBuildingId(),
      StreamBIM.API.getUserEmail(),
    ]);

    elements.projectId.textContent = formatValue(projectId);
    elements.buildingId.textContent = formatValue(buildingId);
    elements.userEmail.textContent = formatValue(userEmail);
  } catch (error) {
    showError(`Kunde inte lasa projektinfo: ${error.message || error}`);
  }
}

async function handlePickedObject(result) {
  if (!result || !result.guid) {
    return;
  }

  state.selectedGuid = result.guid;
  setSelectionState(`Valt objekt: ${result.guid}`, true);
  elements.actionFeedback.textContent = "Laddar objektinformation...";

  try {
    const info = await StreamBIM.API.getObjectInfo(result.guid);
    renderObjectInfo(info || { guid: result.guid });
    elements.actionFeedback.textContent = "Objektets data hamtades fran StreamBIM.";
  } catch (error) {
    renderObjectInfo({ guid: result.guid, description: "Objektet valdes men egenskaper kunde inte hamtas." });
    showError(`Kunde inte lasa objektinfo for ${result.guid}: ${error.message || error}`);
  }
}

async function connectWidget() {
  if (!window.StreamBIM) {
    setConnectionState(false, "StreamBIM API saknas");
    showError("Biblioteket streambim-widget-api kunde inte laddas.");
    return;
  }

  try {
    await StreamBIM.connectToParent(window, {
      pickedObject: handlePickedObject,
    });

    setConnectionState(true, "Ansluten till StreamBIM");
    setSelectionState("Klicka pa ett objekt i modellen", false);
    elements.actionFeedback.textContent = "Widgeten ar ansluten och lyssnar nu pa objektklick.";
    await loadProjectContext();
  } catch (error) {
    setConnectionState(false, "Anslutning misslyckades");
    showError(`Kunde inte ansluta till StreamBIM: ${error.message || error}`);
  }
}

elements.refreshContext.addEventListener("click", async () => {
  elements.actionFeedback.textContent = "Laddar om projektinformation...";
  await loadProjectContext();
});

elements.gotoObject.addEventListener("click", async () => {
  if (!state.selectedGuid) {
    return;
  }

  try {
    await StreamBIM.API.gotoObject(state.selectedGuid);
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
    await StreamBIM.API.highlightObject(state.selectedGuid);
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
    elements.actionFeedback.textContent = `GUID kopierades: ${state.selectedGuid}.`;
  } catch (error) {
    showError(`Kunde inte kopiera GUID: ${error.message || error}`);
  }
});

connectWidget();
