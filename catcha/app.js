let businesses = [];

const storageKey = "catcha-progress-v1";
const savedBusinessesKey = "catcha-saved-businesses-v1";
const legacyStorageKey = "catcha-demo-progress-v1";
const legacySavedBusinessesKey = "catcha-demo-saved-businesses-v1";
const mapBusinessId = /^(?:osm-(node|way|relation)-\d+|geoapify-[A-Za-z0-9_-]{2,2048})$/;
const savedVisuals = new Set(["cafe","flower","food","studio","bakery","book"]);
const businessSearchRadiusKm = 15;
const businessSearchRadiusMeters = businessSearchRadiusKm * 1000;
const businessPageSize = 12;
const aiPlatforms = {
  lovable:{name:"Lovable",url:"https://lovable.dev/"},
  v0:{name:"v0",url:"https://v0.dev/"},
  replit:{name:"Replit",url:"https://replit.com/"},
  framer:{name:"Framer",url:"https://www.framer.com/"}
};
let progress = {};
let savedBusinesses = {};
let filteredBusinesses = [...businesses];
let usingLiveData = false;
let liveScopeLabel = "nessuna ricerca attiva";
let savedFilter = "all";
let businessPage = 1;
let lastGeneratedBrief = "";
let userDataReady = false;
let pendingSave = Promise.resolve();

function readLegacyProgress() {
  try {
    const current = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || "{}");
    const merged = {
      ...(legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy : {}),
      ...(current && typeof current === "object" && !Array.isArray(current) ? current : {})
    };
    const cleaned = Object.fromEntries(Object.entries(merged)
      .filter(([id,state]) => mapBusinessId.test(id) && ["contact","later"].includes(state)));
    return cleaned;
  } catch {
    return {};
  }
}

function readLegacySavedBusinesses() {
  try {
    const current = JSON.parse(localStorage.getItem(savedBusinessesKey) || "{}");
    const legacy = JSON.parse(localStorage.getItem(legacySavedBusinessesKey) || "{}");
    const stored = {
      ...(legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy : {}),
      ...(current && typeof current === "object" && !Array.isArray(current) ? current : {})
    };
    const cleaned = Object.fromEntries(Object.entries(stored)
      .map(([id,item]) => [id, sanitizeSavedBusiness(item,id)])
      .filter(([,item]) => item));
    return cleaned;
  } catch {
    return {};
  }
}

function safeSavedText(value, limit = 2000) {
  return typeof value === "string" ? value.slice(0,limit) : "";
}

function safeSavedUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function sanitizeSavedBusiness(item,id) {
  if (!item || typeof item !== "object" || item.id !== id || !mapBusinessId.test(id)
    || (item.fromOpenStreetMap !== true && item.fromGeoapify !== true)
    || typeof item.name !== "string" || !item.name.trim()) return null;
  const contacts = Array.isArray(item.contacts) ? item.contacts
    .filter(contact => contact && ["email","phone","url"].includes(contact.type) && typeof contact.value === "string")
    .map(contact => ({
      type:contact.type,
      value:contact.type === "url" ? safeSavedUrl(contact.value) : safeSavedText(contact.value,300),
      label:safeSavedText(contact.label,100)
    }))
    .filter(contact => contact.value) : [];
  return {
    id,
    name:safeSavedText(item.name,200),
    category:safeSavedText(item.category,120),
    city:safeSavedText(item.city,120),
    region:safeSavedText(item.region,120),
    area:safeSavedText(item.area,120),
    locationLabel:safeSavedText(item.locationLabel,300),
    status:safeSavedText(item.status,120),
    address:safeSavedText(item.address,300),
    openingHours:safeSavedText(item.openingHours,500),
    sourceDescription:safeSavedText(item.sourceDescription,2000),
    cuisine:safeSavedText(item.cuisine,200),
    description:safeSavedText(item.description,2000),
    emoji:safeSavedText(item.emoji,12),
    visual:savedVisuals.has(item.visual) ? item.visual : "studio",
    opportunity:safeSavedText(item.opportunity,1000),
    fromOpenStreetMap:item.fromOpenStreetMap === true,
    fromGeoapify:item.fromGeoapify === true,
    contactLookupUnavailable:item.contactLookupUnavailable === true,
    osmType:["node","way","relation"].includes(item.osmType) ? item.osmType : "",
    osmId:safeSavedText(String(item.osmId || ""),30),
    distanceMeters:Number.isFinite(item.distanceMeters) ? item.distanceMeters : null,
    photoUrl:safeSavedUrl(item.photoUrl),
    photoPageUrl:safeSavedUrl(item.photoPageUrl),
    contacts
  };
}

function saveProgress() {
  if (!userDataReady) {
    showUserDataStatus("Dati non caricati: ricarica la pagina prima di modificare la lista.",true);
    return Promise.resolve();
  }
  const snapshot = JSON.stringify({progress,savedBusinesses});
  pendingSave = pendingSave.catch(() => undefined).then(async () => {
    showUserDataStatus("Salvataggio in corso…");
    const response = await fetch("/api/data",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      body:snapshot
    });
    if (response.redirected) {
      window.location.replace("/login");
      throw new Error("Sessione scaduta. Accedi di nuovo.");
    }
    if (!response.ok) throw new Error(`Salvataggio non riuscito (HTTP ${response.status}).`);
    showUserDataStatus("Lista salvata sul tuo account.");
  }).catch(error => {
    console.error("User data save failed",error);
    showUserDataStatus(error.message || "Impossibile salvare la lista. Riprova.",true);
  });
  return pendingSave;
}

function showUserDataStatus(text,isError = false) {
  const status = document.getElementById("saved-sync-status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("error",isError);
}

function clearLegacyLocalData() {
  try {
    [storageKey,savedBusinessesKey,legacyStorageKey,legacySavedBusinessesKey].forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn("Could not clear old browser-only data",error);
  }
}

function applyUserData(data) {
  if (!data || !data.progress || typeof data.progress !== "object" || Array.isArray(data.progress)
    || !data.savedBusinesses || typeof data.savedBusinesses !== "object" || Array.isArray(data.savedBusinesses)) {
    throw new Error("Il server ha restituito dati dell'account non validi.");
  }
  progress = Object.fromEntries(Object.entries(data.progress)
    .filter(([id,state]) => mapBusinessId.test(id) && ["contact","later"].includes(state)));
  savedBusinesses = Object.fromEntries(Object.entries(data.savedBusinesses)
    .map(([id,item]) => [id,sanitizeSavedBusiness(item,id)])
    .filter(([,item]) => item));
}

async function loadUserData() {
  showUserDataStatus("Caricamento della lista dal server…");
  const response = await fetch("/api/data",{credentials:"same-origin",cache:"no-store"});
  if (response.redirected) {
    window.location.replace("/login");
    throw new Error("Sessione scaduta. Accedi di nuovo.");
  }
  if (!response.ok) throw new Error(`Impossibile caricare la lista (HTTP ${response.status}).`);
  let data = await response.json();
  if (data.hasData !== true) {
    const legacyData = {progress:readLegacyProgress(),savedBusinesses:readLegacySavedBusinesses()};
    if (Object.keys(legacyData.progress).length || Object.keys(legacyData.savedBusinesses).length) {
      const migration = await fetch("/api/data/migrate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        credentials:"same-origin",
        body:JSON.stringify(legacyData)
      });
      if (migration.redirected) {
        window.location.replace("/login");
        throw new Error("Sessione scaduta. Accedi di nuovo.");
      }
      if (!migration.ok) throw new Error(`Migrazione delle liste non riuscita (HTTP ${migration.status}).`);
      data = await migration.json();
      showUserDataStatus(data.migrated ? "Lista precedente trasferita al tuo account." : "Lista caricata dal tuo account.");
    }
  } else {
    showUserDataStatus("Lista caricata dal tuo account.");
  }
  applyUserData(data);
  userDataReady = true;
  clearLegacyLocalData();
  showUserDataStatus(data.migrated ? "Lista precedente trasferita al tuo account." : "Lista caricata dal tuo account.");
}

function progressFor(id) {
  return progress[id] || "";
}

function renderCards(items, gridId = "business-grid") {
  const savedGrid = gridId === "saved-business-grid";
  const grid = document.getElementById(gridId);
  grid.replaceChildren();
  if (!savedGrid) {
    document.getElementById("results-count").textContent = `${items.length} attività`;
    document.getElementById("results-caption").textContent = ` · ${liveScopeLabel}`;
    businessPage = Math.min(businessPage,Math.max(1,Math.ceil(items.length / businessPageSize)));
    renderBusinessPagination(items.length);
  }
  const emptyState = document.getElementById(savedGrid ? "saved-empty-state" : "empty-state");
  emptyState.hidden = items.length > 0;
  if (!savedGrid && !items.length) {
    document.getElementById("empty-state-title").textContent = usingLiveData ? "Nessuna attività trovata" : "Cerca attività reali nella tua zona";
    document.getElementById("empty-state-copy").textContent = usingLiveData
      ? "Prova un'altra città o categoria. I dati della mappa possono essere incompleti."
      : "Inserisci una città o autorizza la posizione: mostreremo solo risultati restituiti dalla mappa.";
  }
  const visibleItems = savedGrid
    ? items
    : items.slice((businessPage - 1) * businessPageSize,businessPage * businessPageSize);
  for (const business of visibleItems) {
    const state = progressFor(business.id);
    const place = businessPlace(business);
    const status = business.status;
    const publicContacts = (business.contacts || []).slice(0,3).map(contactMarkup).filter(Boolean).join("");
    const contactFallback = business.contactLookupUnavailable
      ? "Recapiti non verificati"
      : "Nessun recapito pubblico nella scheda";
    const card = document.createElement("article");
    card.className = "business-card";
    card.tabIndex = 0;
    card.setAttribute("aria-label", `${business.name}, ${place}. Apri dettagli.`);
    card.innerHTML = `<div class="business-visual visual-${business.visual}"><span class="visual-object" aria-hidden="true">${escapeHtml(business.emoji)}</span><span class="status-pill live-status">${escapeHtml(status)}</span><button class="save-button ${state === "later" ? "is-saved" : ""}" type="button" aria-label="${state === "later" ? "Rimuovi dai promemoria" : "Aggiungi ai promemoria"}" title="Promemoria">${state === "later" ? "★" : "☆"}</button></div>
      <div class="business-info"><span class="business-type">${escapeHtml(business.category)}</span><h3>${escapeHtml(business.name)}</h3><div class="business-location">⌖ ${escapeHtml(place)}</div><p class="business-description">${escapeHtml(business.description)}</p><div class="business-contacts">${publicContacts || `<span class="no-public-contact">${escapeHtml(contactFallback)}</span>`}</div>
      <div class="business-signals"><span class="signal-count"><span class="signal-dot"></span>Fonte: ${business.fromOpenStreetMap ? "OpenStreetMap" : "Geoapify"}</span><span>Verifica i dati prima del contatto</span></div>
      <div class="card-actions"><button class="action-contact ${state === "contact" ? "selected" : ""}" type="button">${state === "contact" ? "✓ In lista contatti" : "＋ Da contattare"}</button><button class="action-later ${state === "later" ? "selected" : ""}" type="button">${state === "later" ? "★ In promemoria" : "☆ Per dopo"}</button></div></div>`;
    if (business.photoUrl) {
      const photo = document.createElement("img");
      photo.className = "business-photo";
      photo.src = business.photoUrl;
      photo.alt = `Foto di ${business.name}`;
      photo.loading = "lazy";
      photo.referrerPolicy = "no-referrer";
      const visual = card.querySelector(".business-visual");
      photo.addEventListener("error", () => {
        photo.remove();
        visual.classList.remove("has-photo");
        visual.querySelector(".photo-attribution")?.remove();
      }, {once:true});
      visual.classList.add("has-photo");
      visual.prepend(photo);
      if (business.photoPageUrl) {
        const attribution = document.createElement("a");
        attribution.className = "photo-attribution";
        attribution.href = business.photoPageUrl;
        attribution.target = "_blank";
        attribution.rel = "noopener noreferrer";
        attribution.textContent = "Foto · Wikimedia Commons ↗";
        visual.append(attribution);
      }
    }
    card.addEventListener("click", event => {
      if (!event.target.closest("button,a")) openBusiness(business.id);
    });
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target === card) openBusiness(business.id);
    });
    card.querySelector(".save-button").addEventListener("click", event => {
      event.stopPropagation();
      setProgress(business.id,state === "later" ? "" : "later");
      renderCards(filteredBusinesses);
      renderSavedBusinesses();
    });
    card.querySelector(".action-contact").addEventListener("click", event => {
      event.stopPropagation();
      setProgress(business.id,state === "contact" ? "" : "contact");
      renderCards(filteredBusinesses);
      renderSavedBusinesses();
    });
    card.querySelector(".action-later").addEventListener("click", event => {
      event.stopPropagation();
      setProgress(business.id,state === "later" ? "" : "later");
      renderCards(filteredBusinesses);
      renderSavedBusinesses();
    });
    grid.append(card);
  }
}

function renderBusinessPagination(totalItems) {
  const pagination = document.getElementById("business-pagination");
  pagination.replaceChildren();
  const totalPages = Math.ceil(totalItems / businessPageSize);
  pagination.hidden = totalPages <= 1;
  if (totalPages <= 1) return;

  const addButton = (label,page,ariaLabel,disabled = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pagination-button";
    button.textContent = label;
    button.setAttribute("aria-label",ariaLabel);
    button.disabled = disabled;
    if (label !== "‹" && label !== "›" && page === businessPage) {
      button.setAttribute("aria-current","page");
      button.classList.add("current");
    }
    button.addEventListener("click",() => {
      businessPage = page;
      renderCards(filteredBusinesses);
      document.getElementById("business-grid").scrollIntoView({behavior:"smooth",block:"start"});
    });
    pagination.append(button);
  };

  addButton("‹",Math.max(1,businessPage - 1),"Pagina precedente",businessPage === 1);
  for (let page = 1; page <= totalPages; page += 1) {
    addButton(String(page),page,`Pagina ${page}`);
  }
  addButton("›",Math.min(totalPages,businessPage + 1),"Pagina successiva",businessPage === totalPages);
}

function applyFilters() {
  businessPage = 1;
  const search = document.getElementById("search-input").value.trim().toLocaleLowerCase("it");
  filteredBusinesses = businesses.filter(item => {
    const searchable = `${item.name} ${item.category} ${item.city} ${item.region} ${item.area} ${item.description}`.toLocaleLowerCase("it");
    return !search || searchable.includes(search);
  });
  renderCards(filteredBusinesses);
}

function businessById(id) {
  return businesses.find(item => item.id === id) || savedBusinesses[id] || null;
}

function setProgress(id,state) {
  if (!userDataReady) {
    showUserDataStatus("Dati non caricati: ricarica la pagina prima di modificare la lista.",true);
    return;
  }
  const business = businessById(id);
  if (state === "contact" || state === "later") {
    progress[id] = state;
    if (business) savedBusinesses[id] = sanitizeSavedBusiness({...business,id},id) || business;
  } else {
    delete progress[id];
    delete savedBusinesses[id];
  }
  saveProgress();
}

function trackedBusinesses() {
  return Object.entries(progress)
    .filter(([,state]) => state === "contact" || state === "later")
    .map(([id]) => businessById(id))
    .filter(Boolean);
}

function renderSavedBusinesses() {
  const items = trackedBusinesses();
  const contacts = items.filter(item => progressFor(item.id) === "contact").length;
  const later = items.filter(item => progressFor(item.id) === "later").length;
  document.getElementById("saved-contact-count").textContent = String(contacts);
  document.getElementById("saved-later-count").textContent = String(later);
  document.getElementById("saved-nav-count").textContent = String(items.length);
  const visible = savedFilter === "all" ? items : items.filter(item => progressFor(item.id) === savedFilter);
  const savedLabel = visible.length === 1 ? " salvata" : " salvate";
  const filterLabel = savedFilter === "all" ? savedLabel : savedFilter === "contact" ? " da contattare" : " per dopo";
  document.getElementById("saved-results-label").textContent = `${visible.length} attività${filterLabel}`;
  document.getElementById("saved-empty-title").textContent = items.length
    ? "Nessuna attività in questa sezione"
    : "La tua lista è ancora vuota";
  document.getElementById("saved-empty-copy").textContent = items.length
    ? "Prova un altro filtro oppure sposta un'attività da una lista all'altra."
    : "Quando trovi un'attività interessante, aggiungila a “Da contattare” oppure mettila “Per dopo”.";
  renderCards(visible,"saved-business-grid");
}

function updateToolCompanyContext() {
  const item = currentBusiness();
  document.getElementById("tool-company-context").textContent = item
    ? `${item.category} · ${businessPlace(item)}`
    : "Seleziona un'attività per personalizzare proposta e brief.";
  ["pitch-output","ai-output","estimate-output"].forEach(id => {
    const output = document.getElementById(id);
    output.textContent = "";
    output.hidden = true;
  });
  document.getElementById("copy-pitch").hidden = true;
  document.getElementById("copy-brief").hidden = true;
  document.getElementById("open-ai-platform").hidden = true;
  lastGeneratedBrief = "";
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toLocaleString("it-IT", {maximumFractionDigits:1})} km`;
}

function businessPlace(item) {
  const address = [item.area,item.city,item.region].filter(Boolean).join(", ");
  const distance = Number.isFinite(item.distanceMeters) ? `a ${formatDistance(item.distanceMeters)}` : "";
  return [address || item.locationLabel,distance].filter(Boolean).join(" · ") || "Nei dintorni";
}

function contactHref(contact) {
  if (contact.type === "email") return `mailto:${encodeURIComponent(contact.value)}`;
  if (contact.type === "phone") return `tel:${contact.value.replace(/[^\d+]/g,"")}`;
  if (contact.type === "url") {
    try {
      const url = new URL(contact.value);
      return ["http:","https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }
  return "";
}

function contactMarkup(contact) {
  const href = contactHref(contact);
  if (!href) return "";
  const target = contact.type === "email" || contact.type === "phone" ? "_self" : "_blank";
  return `<a href="${escapeHtml(href)}" target="${target}" rel="noopener noreferrer">${escapeHtml(contact.label || contact.value)}</a>`;
}

function currentBusiness() {
  const id = document.getElementById("tool-company").value;
  return businessById(id) || null;
}

function openBusiness(id) {
  const item = businessById(id);
  if (!item) return;
  const contacts = (item.contacts || []).map(contactMarkup).filter(Boolean).join(" · ");
  const sourceName = item.fromOpenStreetMap ? "OpenStreetMap" : "Geoapify";
  const contactLabel = contacts
    ? `Contatti pubblicati nella scheda ${sourceName}`
    : item.contactLookupUnavailable ? "Ricerca dei recapiti non disponibile; verifica i dati della scheda" : `La scheda ${sourceName} non riporta recapiti pubblici`;
  const profileDetails = [
    ["INDIRIZZO",item.address],
    ["ORARI",item.openingHours],
    ["DETTAGLI",item.sourceDescription],
    ["CUCINA",item.cuisine]
  ].filter(([,value]) => value).map(([label,value]) => `<p class="profile-detail"><strong>${label}</strong><span>${escapeHtml(value)}</span></p>`).join("");
  const photoPanel = item.photoUrl
    ? `<figure class="detail-photo"><img src="${escapeHtml(item.photoUrl)}" alt="Foto di ${escapeHtml(item.name)}" referrerpolicy="no-referrer"><figcaption><a href="${escapeHtml(item.photoPageUrl)}" target="_blank" rel="noopener noreferrer">Immagine da Wikimedia Commons ↗</a></figcaption></figure>`
    : "";
  const osmLink = item.osmType && item.osmId ? `<p><a class="osm-source-link" href="https://www.openstreetmap.org/${encodeURIComponent(item.osmType)}/${encodeURIComponent(item.osmId)}" target="_blank" rel="noopener noreferrer">Apri la scheda su OpenStreetMap ↗</a></p>` : "";
  document.getElementById("business-detail").innerHTML = `<div class="detail-top"><span class="business-type">${escapeHtml(item.category)}</span><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(businessPlace(item))}</p></div>
    <div class="detail-content">${photoPanel}${profileDetails}<h3>Un'idea da esplorare</h3><p>${escapeHtml(item.opportunity)}</p><h3>Probabilità di approvazione</h3><p>Non calcolabile dai dati disponibili: dipende da budget, priorità, tempi e qualità della proposta. Chiedi direttamente all'attività.</p><h3>Prima di contattarla</h3><ul><li>Verifica che il progetto sia adatto alle reali esigenze dell'attività.</li><li>Controlla i canali ufficiali e chiedi il permesso prima di usare loghi o immagini.</li><li>La mappa non conferma che l'attività sia priva di sito: verifica prima di proporre il lavoro.</li></ul>
    <div class="detail-contact"><strong>CONTATTO</strong><span>${escapeHtml(contactLabel)}</span>${contacts ? `<span class="public-contacts">${contacts}</span>` : ""}<span class="contact-guidance">${item.contactLookupUnavailable ? "I recapiti non sono stati recuperati in questa ricerca; verifica i dati della scheda." : "La scheda potrebbe non contenere recapiti. Verifica anche i canali ufficiali dell'attività."}</span></div>${osmLink}
    <div class="detail-buttons"><button class="button button-outline" id="detail-later" type="button">☆ Per dopo</button><button class="button button-dark" id="detail-contact" type="button">＋ Da contattare</button></div></div>`;
  const modal = document.getElementById("business-modal");
  modal.showModal();
  document.getElementById("detail-later").addEventListener("click", () => {
    setProgress(id,progressFor(id) === "later" ? "" : "later");
    renderCards(filteredBusinesses);
    renderSavedBusinesses();
    modal.close();
  });
  document.getElementById("detail-contact").addEventListener("click", () => {
    setProgress(id,progressFor(id) === "contact" ? "" : "contact");
    renderCards(filteredBusinesses);
    renderSavedBusinesses();
    modal.close();
  });
}

function populateToolBusinesses() {
  const select = document.getElementById("tool-company");
  const previous = select.value;
  select.replaceChildren(new Option("Scegli un'attività dalla lista", ""));
  const options = new Map([...trackedBusinesses(),...businesses].map(item => [item.id,item]));
  options.forEach(item => select.add(new Option(`${item.name} · ${businessPlace(item)}`, item.id)));
  if (options.has(previous)) select.value = previous;
  updateToolCompanyContext();
}

function distanceBetween(lat1, lon1, lat2, lon2) {
  const radians = value => value * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapCategory(tags) {
  if (tags.shop) return {category:`NEGOZIO · ${tags.shop.replace(/_/g, " ").toLocaleUpperCase("it")}`,emoji:"✦",visual:"studio"};
  if (tags.craft) return {category:`ARTIGIANATO · ${tags.craft.replace(/_/g, " ").toLocaleUpperCase("it")}`,emoji:"⚒",visual:"bakery"};
  const types = {
    cafe:["BAR · CAFFÈ","☕","cafe"],
    restaurant:["RISTORAZIONE","🍽","food"],
    fast_food:["RISTORAZIONE","🥡","food"],
    bar:["BAR · LOCALE","◉","cafe"],
    pub:["BAR · PUB","◉","cafe"],
    ice_cream:["GELATERIA","✦","bakery"],
    library:["CULTURA · LIBRERIA","▤","book"],
    arts_centre:["CULTURA · SPAZIO ARTI","✳","studio"],
    theatre:["CULTURA · TEATRO","✳","studio"],
    cinema:["CULTURA · CINEMA","✦","studio"],
    marketplace:["MERCATO","✦","food"],
    community_centre:["SPAZIO · COMUNITÀ","✳","flower"]
  };
  const [category,emoji,visual] = types[tags.amenity] || ["ATTIVITÀ LOCALE","✦","studio"];
  return {category,emoji,visual};
}

function getWikimediaPhoto(tags) {
  const commonsValue = tags.wikimedia_commons || "";
  const file = commonsValue.replace(/^Wikimedia Commons:/i, "").trim();
  if (/^File:/i.test(file)) {
    const filename = file.replace(/^File:/i, "").replace(/ /g, "_");
    const encodedFilename = encodeURIComponent(filename);
    return {
      url:`https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=720`,
      page:`https://commons.wikimedia.org/wiki/File:${encodedFilename}`
    };
  }
  const image = tags.image || "";
  if (/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//i.test(image)) {
    return {url:image,page:"https://commons.wikimedia.org/"};
  }
  return null;
}

function addContactTags(contacts, tags, keys, type, label) {
  for (const key of keys) {
    for (const value of String(tags[key] || "").split(/[;,]/).map(item => item.trim()).filter(Boolean)) {
      if (!contacts.some(contact => contact.type === type && contact.value.toLocaleLowerCase("it") === value.toLocaleLowerCase("it"))) {
        contacts.push({type,value,label:label(value)});
      }
    }
  }
}

function mapBusiness(element, center) {
  const tags = element.tags || {};
  const lat = Number(element.lat ?? (element.center && element.center.lat));
  const lon = Number(element.lon ?? (element.center && element.center.lon));
  const category = mapCategory(tags);
  const name = tags.name || tags["name:it"] || "Attività locale";
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || tags["addr:municipality"] || "";
  const region = tags["addr:state"] || tags["is_in:state"] || "";
  const area = tags["addr:suburb"] || tags["addr:neighbourhood"] || tags["addr:quarter"] || "";
  const street = [tags["addr:street"],tags["addr:housenumber"]].filter(Boolean).join(" ");
  const address = [street,tags["addr:postcode"],city].filter(Boolean).join(", ");
  const contacts = [];
  addContactTags(contacts,tags,["contact:phone","phone"],"phone",value => `Tel. ${value}`);
  addContactTags(contacts,tags,["contact:mobile","mobile"],"phone",value => `Cell. ${value}`);
  addContactTags(contacts,tags,["contact:email","email"],"email",value => value);
  for (const [key,label] of [["contact:instagram","Instagram"],["contact:facebook","Facebook"]]) {
    const value = tags[key];
    if (value && /^https:\/\/[^\s]+$/i.test(value)) contacts.push({type:"url",value,label});
  }
  const websiteValue = [tags["contact:website"],tags.website,tags["contact:url"],tags.url]
    .flatMap(value => String(value || "").split(/[;,]/))
    .map(value => value.trim())
    .find(value => value && !/^(?:no|none|false|0|n\/a|unknown)$/i.test(value)) || "";
  const website = websiteValue && /^https?:\/\//i.test(websiteValue) ? websiteValue : websiteValue ? `https://${websiteValue}` : "";
  const hasWebsite = Boolean(websiteValue);
  if (website && /^https?:\/\/[^\s]+$/i.test(website) && !contacts.some(contact => contact.value === website)) {
    contacts.push({type:"url",value:website,label:"Sito web"});
  }
  const parts = [area,city,region].filter(Boolean).join(", ");
  const distanceMeters = center ? distanceBetween(center.latitude,center.longitude,lat,lon) : null;
  const photo = getWikimediaPhoto(tags);
  const sourceName = element.fromOpenStreetMap === false ? "Geoapify" : "OpenStreetMap";
  return {
    id:element.businessId || `osm-${element.type}-${element.id}`,
    name,
    category:category.category,
    city,
    region,
    area,
    locationLabel:parts || "Nelle vicinanze",
    status:hasWebsite ? "SITO WEB INDICATO" : "SITO DA VERIFICARE",
    hasWebsite,
    address,
    openingHours:tags.opening_hours || "",
    sourceDescription:tags["description:it"] || tags.description || "",
    cuisine:tags.cuisine ? tags.cuisine.replace(/;/g,", ") : "",
    photoUrl:photo && photo.url,
    photoPageUrl:photo && photo.page,
    description:tags["description:it"] || tags.description || (Number.isFinite(distanceMeters)
      ? `Attività mappata a ${formatDistance(distanceMeters)}. Verifica sui canali ufficiali se ha già un sito.`
      : `Attività presente nei dati ${sourceName}. Verifica sui canali ufficiali se ha già un sito.`),
    emoji:category.emoji,
    visual:category.visual,
    contacts,
    opportunity:"Verifica prima se esiste già un sito. Se manca, chiedi all'attività quali esigenze digitali vorrebbe risolvere.",
    fromOpenStreetMap:element.fromOpenStreetMap !== false,
    fromGeoapify:element.fromGeoapify === true,
    osmType:element.osmType !== undefined ? element.osmType : element.type,
    osmId:element.osmId !== undefined ? element.osmId : element.id,
    distanceMeters
  };
}

function mapGeoapifyFeature(feature, center) {
  if (!feature || typeof feature !== "object") return null;
  const properties = feature.properties || {};
  const coordinates = feature.geometry && feature.geometry.coordinates;
  const raw = properties.extra && typeof properties.extra === "object"
    ? properties.extra
    : properties.datasource?.raw && typeof properties.datasource.raw === "object" ? properties.datasource.raw : {};
  const types = {N:"node",W:"way",R:"relation",n:"node",w:"way",r:"relation",node:"node",way:"way",relation:"relation"};
  const type = types[raw.osm_type || properties.osm_type];
  const osmId = Number(raw.osm_id || properties.osm_id);
  const longitude = Array.isArray(coordinates) ? Number(coordinates[0]) : NaN;
  const latitude = Array.isArray(coordinates) ? Number(coordinates[1]) : NaN;
  const name = typeof properties.name === "string" ? properties.name.trim() : "";
  const hasOsmId = type && Number.isSafeInteger(osmId) && osmId > 0;
  const placeId = typeof properties.place_id === "string" ? properties.place_id : "";
  const businessId = hasOsmId ? `osm-${type}-${osmId}` : placeId ? `geoapify-${placeId}` : "";
  if (!businessId || !name || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  const tags = {...raw,name};
  const categories = Array.isArray(properties.categories) ? properties.categories : [];
  if (!tags.shop && !tags.craft && !tags.amenity) {
    const category = categories.find(value => typeof value === "string") || "";
    if (category === "commercial") tags.shop = "shop";
    else if (category.startsWith("commercial.")) tags.shop = category.slice("commercial.".length).split(".").pop();
    else if (category.startsWith("catering.")) {
      const type = category.slice("catering.".length).split(".")[0];
      tags.amenity = type === "cafe" ? "cafe" : type === "restaurant" ? "restaurant"
        : type === "fast_food" ? "fast_food" : type === "bar" ? "bar" : type === "pub" ? "pub"
          : type === "ice_cream" ? "ice_cream" : "";
    } else if (category === "activity.community_center") tags.amenity = "community_centre";
    else if (category.includes("theatre")) tags.amenity = "theatre";
    else if (category.includes("cinema")) tags.amenity = "cinema";
    else if (category.includes("library")) tags.amenity = "library";
    else if (category.includes("marketplace")) tags.shop = "marketplace";
  }
  const addressTags = {
    street:"addr:street",
    housenumber:"addr:housenumber",
    postcode:"addr:postcode",
    city:"addr:city",
    state:"addr:state",
    suburb:"addr:suburb",
    district:"addr:suburb",
    county:"addr:county"
  };
  for (const [source,target] of Object.entries(addressTags)) {
    if (properties[source]) tags[target] = properties[source];
  }
  for (const key of ["phone","mobile","email","website","url","opening_hours","cuisine","description","wikimedia_commons","image"]) {
    if (properties[key]) tags[key] = properties[key];
  }
  const sourceName = String(properties.datasource?.sourcename || "").toLocaleLowerCase("en-US");
  return mapBusiness({
    type:type || "node",
    id:hasOsmId ? osmId : 0,
    businessId,
    fromOpenStreetMap:hasOsmId || sourceName.includes("openstreetmap"),
    fromGeoapify:true,
    osmType:hasOsmId ? type : "",
    osmId:hasOsmId ? osmId : "",
    lon:longitude,
    lat:latitude,
    tags
  },center);
}

async function loadNearbyBusinesses(latitude, longitude, options) {
  const params = new URLSearchParams();
  let center = null;
  if (options.placeId) {
    params.set("placeId",options.placeId);
  } else if (options.bbox) {
    params.set("bbox",options.bbox.join(","));
  } else {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (latitude === null || latitude === undefined || latitude === "" || longitude === null || longitude === undefined || longitude === "" ||
        !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error("Non ho ricevuto coordinate valide. Cerca una città o controlla i permessi di posizione.");
    }
    params.set("lat",String(lat));
    params.set("lon",String(lon));
    center = {latitude:lat,longitude:lon};
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`/api/nearby?${params}`, {credentials:"same-origin",signal:controller.signal});
    if (response.status === 429) throw new Error("Il servizio di ricerca delle attività è temporaneamente sotto limite. Riprova tra poco.");
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (payload?.error === "Invalid map search bounds") throw new Error("I confini restituiti per la regione non sono validi. Prova a cercare una città della regione.");
      if (payload?.error === "Invalid map search location") throw new Error("Le coordinate della posizione non sono valide. Riprova con una città o aggiorna la posizione del browser.");
      if (payload?.error?.includes("Geoapify API key")) throw new Error("La chiave Geoapify non è configurata correttamente sul server.");
      throw new Error(`Servizio di ricerca delle attività non disponibile (HTTP ${response.status}).`);
    }
    if (!payload || !Array.isArray(payload.features)) throw new Error("La risposta della ricerca luoghi non è valida.");
    const region = normalizePlace(options.region || "");
    const results = payload.features
      .filter(feature => {
        const state = normalizePlace(feature.properties?.state || "");
        return !region || (state && (state.includes(region) || region.includes(state))) || (options.placeId && !state);
      })
      .map(feature => mapGeoapifyFeature(feature,center))
      .filter(item => item && !item.hasWebsite
        && (item.distanceMeters === null || item.distanceMeters <= businessSearchRadiusMeters))
      .sort((a,b) => Number.isFinite(a.distanceMeters) && Number.isFinite(b.distanceMeters)
        ? a.distanceMeters-b.distanceMeters
        : a.name.localeCompare(b.name,"it"))
      .slice(0,50);
    for (const item of results) item.contactLookupUnavailable = payload.contactLookupAvailable === false;
    return results;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizePlace(value) {
  return value.trim().toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function geocodePlace(city, region) {
  const params = new URLSearchParams({city,region});
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api/geocode?${params}`, {credentials:"same-origin",signal:controller.signal});
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (response.status === 429) throw new Error("Il servizio di ricerca geografica è occupato. Riprova tra poco.");
      if (payload?.error?.includes("Geoapify API key")) throw new Error("La chiave Geoapify non è configurata correttamente sul server.");
      throw new Error(`Servizio di ricerca geografica non disponibile (HTTP ${response.status}).`);
    }
    const results = await response.json();
    if (!Array.isArray(results)) throw new Error("Risposta geografica non valida.");
    const italianResults = results.filter(result => !result.address?.country_code || result.address.country_code === "it");
    if (!italianResults.length) throw new Error("Luogo non trovato in Italia. Controlla città e regione.");
    const normalizedRegion = normalizePlace(region);
    const matchingResults = normalizedRegion
      ? italianResults.filter(result => {
        const state = normalizePlace(result.address?.state || result.address?.region || "");
        return state && (state.includes(normalizedRegion) || normalizedRegion.includes(state));
      })
      : italianResults;
    if (normalizedRegion && !matchingResults.length) throw new Error("Non trovo questa città nella regione indicata. Controlla i nomi e riprova.");
    if (!city) {
      const result = matchingResults[0];
      if (typeof result.place_id !== "string" || !result.place_id) {
        throw new Error("Non riesco a trovare il confine della regione sulla mappa. Prova con una città della regione.");
      }
      return {
        placeId:result.place_id,
        label:result.name || region
      };
    }
    const requestedCity = normalizePlace(city);
    const localities = matchingResults.filter(result =>
      ["city","town","village","municipality","hamlet"].includes(result.addresstype)
    );
    const result = localities.find(item => {
      const address = item.address || {};
      return [address.city,address.town,address.village,address.municipality,address.hamlet]
        .some(value => value && normalizePlace(value) === requestedCity);
    }) || localities.find(item => normalizePlace(item.name || "") === requestedCity);
    if (!result) throw new Error("Non trovo il centro di questa città nella regione indicata. Controlla i nomi e riprova.");
    const latitude = Number(result.lat);
    const longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("La mappa non ha restituito le coordinate di questo luogo.");
    return {
      latitude,
      longitude,
      label:result.name || city
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function showLiveBusinesses(items, scope) {
  businesses = items;
  usingLiveData = true;
  liveScopeLabel = scope;
  populateToolBusinesses();
  filteredBusinesses = [...businesses];
  applyFilters();
  document.getElementById("sort-button").innerHTML = Number.isFinite(businesses[0]?.distanceMeters)
    ? 'Più vicine <span aria-hidden="true">⌄</span>'
    : 'Ordine alfabetico <span aria-hidden="true">⌄</span>';
}

function locationErrorMessage(error) {
  if (error && error.code === 1) return "Permesso di posizione negato. Puoi abilitarlo dalle impostazioni del browser.";
  if (error && error.code === 2) return "Posizione non disponibile. Riprova o verifica il GPS del dispositivo.";
  if (error && error.code === 3) return "Rilevamento posizione scaduto. Riprova.";
  if (error && error.name === "AbortError") return "La ricerca sulla mappa ha impiegato troppo tempo. Riprova.";
  return error && error.message ? error.message : "Impossibile rilevare la posizione.";
}

async function findNearby() {
  const button = document.getElementById("locate-button");
  const status = document.getElementById("location-status");
  button.disabled = true;
  status.textContent = "Attendo il permesso di posizione…";
  try {
    if (!navigator.geolocation) throw new Error("Questo browser non supporta la geolocalizzazione.");
    const position = await new Promise((resolve,reject) => navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:15000,maximumAge:60000}));
    status.textContent = "Posizione rilevata. Cerco attività nella mappa…";
    const nearby = await loadNearbyBusinesses(position.coords.latitude,position.coords.longitude,{});
    document.getElementById("search-input").value = "";
    document.getElementById("region-input").value = "";
    document.getElementById("city-input").value = "";
    showLiveBusinesses(nearby,`Geoapify · entro ${businessSearchRadiusKm} km`);
    status.textContent = nearby.length
      ? `Mappa caricata: ${nearby.length} attività entro ${businessSearchRadiusKm} km. Dati Geoapify, non verificati in tempo reale.`
      : `Nessuna attività compatibile trovata entro ${businessSearchRadiusKm} km. Puoi riprovare più tardi.`;
  } catch (error) {
    status.textContent = locationErrorMessage(error);
  } finally {
    button.disabled = false;
  }
}

async function findPlace() {
  const city = document.getElementById("city-input").value.trim();
  const region = document.getElementById("region-input").value.trim();
  const status = document.getElementById("location-status");
  const button = document.getElementById("filter-form").querySelector('button[type="submit"]');
  if (!city && !region) {
    applyFilters();
    return;
  }
  button.disabled = true;
  status.textContent = "Cerco il luogo sulla mappa…";
  try {
    const place = await geocodePlace(city,region);
    status.textContent = place.placeId
      ? `Cerco le attività nella regione ${place.label}…`
      : `Cerco le attività vicino a ${place.label}…`;
    const results = place.placeId
      ? await loadNearbyBusinesses(null,null,{placeId:place.placeId,region})
      : await loadNearbyBusinesses(place.latitude,place.longitude,{});
    document.getElementById("search-input").value = "";
    showLiveBusinesses(results,place.placeId
      ? `Geoapify · regione ${place.label} · max 50`
      : `Geoapify · ${place.label} · raggio ${businessSearchRadiusKm} km`);
    status.textContent = place.placeId
      ? `${results.length} attività trovate per ${place.label}${results.length === 50 ? " (mostrate fino a 50)" : ""}. Recapiti e siti non verificati.`
      : `${results.length} attività trovate entro ${businessSearchRadiusKm} km da ${place.label}. Dati di Geoapify, non verificati in tempo reale.`;
  } catch (error) {
    status.textContent = locationErrorMessage(error);
  } finally {
    button.disabled = false;
  }
}

function aiBusinessPayload(item) {
  return {
    name:item.name,
    category:item.category,
    city:item.city,
    region:item.region,
    opportunity:item.opportunity
  };
}

async function requestAi(task, payload) {
  let response;
  try {
    response = await fetch(`/api/ai/${task}`,{
      method:"POST",
      credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(65000)
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error("La richiesta AI è scaduta. Riprova tra poco.");
    throw new Error("Impossibile raggiungere Catcha. Verifica che il server sia attivo.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Risposta non valida dal server (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(result.error || `Generazione AI non riuscita (HTTP ${response.status}).`);
  if (!result || !result.result) throw new Error("Gemini non ha restituito un risultato utilizzabile.");
  return result.result;
}

async function generatePitch() {
  const output = document.getElementById("pitch-output");
  const copyButton = document.getElementById("copy-pitch");
  const generateButton = document.getElementById("generate-pitch");
  const item = currentBusiness();
  if (!item) {
    output.textContent = "Scegli prima un'attività dal menu qui sopra.";
    output.hidden = false;
    copyButton.hidden = true;
    return;
  }
  copyButton.hidden = true;
  output.textContent = "Gemini sta preparando una proposta su misura…";
  output.hidden = false;
  const originalLabel = generateButton.innerHTML;
  generateButton.disabled = true;
  generateButton.textContent = "Genero la proposta…";
  try {
    const result = await requestAi("proposal",{
      business:aiBusinessPayload(item),
      context:document.getElementById("tool-context").value.trim()
    });
    const personalizations = result.personalizations.length
      ? `\n\nDa verificare e personalizzare:\n${result.personalizations.map(point => `• ${point}`).join("\n")}`
      : "";
    output.textContent = `Oggetto: ${result.subject}\n\n${result.message}${personalizations}`;
    copyButton.hidden = false;
    copyButton.textContent = "Copia il messaggio";
  } catch (error) {
    output.textContent = error.message || "Non è stato possibile generare la proposta.";
  } finally {
    generateButton.disabled = false;
    generateButton.innerHTML = originalLabel;
  }
}

async function prepareBrief() {
  const item = currentBusiness();
  const output = document.getElementById("ai-output");
  const generateButton = document.getElementById("open-ai");
  const copyButton = document.getElementById("copy-brief");
  const platformLink = document.getElementById("open-ai-platform");
  if (!item) {
    output.textContent = "Scegli prima un'attività dal menu qui sopra per preparare il brief.";
    output.hidden = false;
    copyButton.hidden = true;
    platformLink.hidden = true;
    return;
  }
  lastGeneratedBrief = "";
  copyButton.hidden = true;
  platformLink.hidden = true;
  output.textContent = "Gemini sta progettando il brief per questa attività…";
  output.hidden = false;
  const originalLabel = generateButton.innerHTML;
  generateButton.disabled = true;
  generateButton.textContent = "Creo il brief…";
  try {
    const result = await requestAi("brief",{
      business:aiBusinessPayload(item),
      context:document.getElementById("tool-context").value.trim()
    });
    lastGeneratedBrief = `${result.title}\n\n${result.prompt}`;
    output.textContent = lastGeneratedBrief;
    copyButton.hidden = false;
    updateAiPlatformLink();
    platformLink.hidden = false;
  } catch (error) {
    output.textContent = error.message || "Non è stato possibile generare il brief.";
  } finally {
    generateButton.disabled = false;
    generateButton.innerHTML = originalLabel;
  }
}

function updateAiPlatformLink() {
  const service = aiPlatforms[document.getElementById("ai-select").value] || aiPlatforms.lovable;
  const platformLink = document.getElementById("open-ai-platform");
  platformLink.href = service.url;
  platformLink.textContent = `Apri ${service.name} ↗`;
}

async function copyBrief() {
  const output = document.getElementById("ai-output");
  if (!lastGeneratedBrief) return;
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard non disponibile");
    await navigator.clipboard.writeText(lastGeneratedBrief);
    document.getElementById("copy-brief").textContent = "Brief copiato";
  } catch {
    output.textContent = `${lastGeneratedBrief}\n\nSeleziona il testo e copialo manualmente.`;
  }
}

async function estimateValue() {
  const input = document.getElementById("preview-description").value.trim();
  const output = document.getElementById("estimate-output");
  const button = document.getElementById("estimate-value");
  const item = currentBusiness();
  if (!item) {
    output.textContent = "Scegli prima un'attività dal menu qui sopra.";
    output.hidden = false;
    return;
  }
  if (!input) {
    output.textContent = "Descrivi la preview e le funzioni del progetto.";
    output.hidden = false;
    return;
  }
  output.textContent = "Gemini sta valutando la descrizione…";
  output.hidden = false;
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = "Valuto il progetto…";
  try {
    const result = await requestAi("estimate",{
      business:aiBusinessPayload(item),
      preview:input
    });
    const money = new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR",maximumFractionDigits:0});
    const assumptions = result.assumptions.length
      ? `\n\nAssunzioni e aspetti da chiarire:\n${result.assumptions.map(point => `• ${point}`).join("\n")}`
      : "";
    output.textContent = `Intervallo orientativo: ${money.format(result.minimum)} – ${money.format(result.maximum)}\n\n${result.summary}\n\nConfidenza: ${result.confidence}${assumptions}\n\nNon è un preventivo professionale: verifica requisiti, revisioni, tasse, manutenzione e costi di terzi.`;
  } catch (error) {
    output.textContent = error.message || "Non è stato possibile stimare il progetto.";
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

function setupLogout() {
  document.getElementById("logout-button").addEventListener("click", async event => {
    const button = event.currentTarget;
    const message = document.getElementById("logout-message");
    button.disabled = true;
    message.textContent = "Chiusura sessione…";
    try {
      const response = await fetch("/api/logout", {method:"POST",credentials:"same-origin"});
      if (!response.ok) throw new Error(`Logout non riuscito (HTTP ${response.status}).`);
      window.location.replace("/login");
    } catch (error) {
      message.textContent = error.message || "Impossibile contattare il server. Riprova.";
      button.disabled = false;
    }
  });
}

async function loadAccountUsername() {
  const username = document.getElementById("account-username");
  const status = document.getElementById("account-status");
  try {
    const response = await fetch("/api/session", {credentials:"same-origin",cache:"no-store"});
    if (!response.ok) throw new Error(`Profilo non disponibile (HTTP ${response.status}).`);
    const account = await response.json();
    if (typeof account.username !== "string" || !account.username.trim()) throw new Error("Il server non ha restituito lo username.");
    username.textContent = account.username;
    document.getElementById("admin-link").hidden = account.isAdmin !== true;
  } catch {
    username.textContent = "Non disponibile";
    status.textContent = "Impossibile caricare lo username. Ricarica la pagina.";
    status.hidden = false;
  }
}

function openReceipt() {
  const dialog = document.getElementById("receipt-modal");
  const date = document.querySelector('#receipt-form input[name="date"]');
  if (!date.value) date.value = new Date().toISOString().slice(0,10);
  dialog.showModal();
}

function setupReceipt() {
  document.getElementById("open-receipt").addEventListener("click", openReceipt);
  document.getElementById("receipt-form").addEventListener("submit", event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const date = new Date(`${values.date}T12:00:00`).toLocaleDateString("it-IT");
    const preview = document.getElementById("receipt-preview");
    preview.innerHTML = `<h3>Ricevuta per prestazione</h3><p><strong>Numero:</strong> ${escapeHtml(values.number)} · <strong>Data:</strong> ${escapeHtml(date)}</p><p><strong>Emessa da:</strong> ${escapeHtml(values.issuer)}<br><strong>Cliente:</strong> ${escapeHtml(values.client)}</p><p><strong>Descrizione:</strong> ${escapeHtml(values.description)}</p><p class="receipt-total">Importo lordo: ${amount.toLocaleString("it-IT",{style:"currency",currency:"EUR"})}</p><p>Documento dimostrativo non fiscale. Verificare gli obblighi applicabili prima dell'utilizzo.</p>`;
    preview.hidden = false;
    document.getElementById("print-receipt").hidden = false;
  });
  document.getElementById("print-receipt").addEventListener("click", () => {
    document.documentElement.classList.add("print-mode");
    window.print();
  });
  window.addEventListener("afterprint", () => document.documentElement.classList.remove("print-mode"));
}

async function copyPitch() {
  const text = document.getElementById("pitch-output").textContent;
  const button = document.getElementById("copy-pitch");
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard non disponibile");
    await navigator.clipboard.writeText(text);
    button.textContent = "Copiato";
  } catch {
    button.textContent = "Seleziona e copia il testo";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
}

function setupDialogs() {
  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  document.querySelectorAll("dialog.modal").forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  }));
}

document.getElementById("filter-form").addEventListener("submit", event => {
  event.preventDefault();
  if (document.getElementById("city-input").value.trim() || document.getElementById("region-input").value.trim()) findPlace();
  else applyFilters();
});
document.getElementById("search-input").addEventListener("input", applyFilters);
document.getElementById("sort-button").addEventListener("click", () => {
  businessPage = 1;
  filteredBusinesses = [...filteredBusinesses].sort((a,b) => {
    if (Number.isFinite(a.distanceMeters) && Number.isFinite(b.distanceMeters)) return a.distanceMeters-b.distanceMeters;
    return a.name.localeCompare(b.name,"it");
  });
  renderCards(filteredBusinesses);
});
document.getElementById("generate-pitch").addEventListener("click", generatePitch);
document.getElementById("open-ai").addEventListener("click", prepareBrief);
document.getElementById("copy-brief").addEventListener("click", copyBrief);
document.getElementById("ai-select").addEventListener("change", updateAiPlatformLink);
document.getElementById("estimate-value").addEventListener("click", estimateValue);
document.getElementById("locate-button").addEventListener("click", findNearby);
document.getElementById("copy-pitch").addEventListener("click", copyPitch);
document.getElementById("tool-company").addEventListener("change", updateToolCompanyContext);
document.querySelectorAll(".saved-filter").forEach(button => button.addEventListener("click", () => {
  savedFilter = button.dataset.savedFilter;
  document.querySelectorAll(".saved-filter").forEach(item => {
    item.classList.toggle("active",item === button);
    item.setAttribute("aria-pressed",String(item === button));
  });
  renderSavedBusinesses();
}));
function viewFromHash() {
  const target = location.hash.slice(1);
  return document.getElementById(target)?.dataset.appPage || "explore";
}

function setAppPage(view, scroll = false) {
  const nextView = ["explore","saved","tools"].includes(view) ? view : "explore";
  const changed = document.body.dataset.appPage !== nextView;
  document.body.dataset.appPage = nextView;
  document.querySelectorAll("[data-app-page]").forEach(section => {
    section.hidden = section.dataset.appPage !== nextView;
  });
  document.querySelectorAll(".nav-link[data-view]").forEach(link => {
    link.classList.toggle("active",link.dataset.view === nextView);
  });
  if (nextView === "saved") renderSavedBusinesses();
  if (nextView === "tools") populateToolBusinesses();
  if (scroll && changed) window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll(".nav-link[data-view]").forEach(link => link.addEventListener("click", () => setAppPage(link.dataset.view,true)));
window.addEventListener("hashchange", () => setAppPage(viewFromHash(),true));
setupLogout();
setupReceipt();
setupDialogs();
async function initializeApp() {
  try {
    await Promise.all([loadUserData(),loadAccountUsername()]);
  } catch (error) {
    console.error("User data load failed",error);
    showUserDataStatus(error.message || "Impossibile caricare i dati dell'account.",true);
  }
  populateToolBusinesses();
  renderCards(businesses);
  renderSavedBusinesses();
  setAppPage(viewFromHash());
}

initializeApp();
