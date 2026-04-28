// ========== GLOBÁLNE PREMENNÉ ==========
let dbClient = null;
let data = { contacts: [], invoices: [], transactions: [] };

// ========== SUPABASE PRIPOJENIE ==========
async function connectSupabase() {
  const url = document.getElementById("sb-url").value.trim();
  const key = document.getElementById("sb-key").value.trim();
  const status = document.getElementById("setup-status");

  if (!url || !key) {
    status.innerHTML =
      '<span style="color:var(--danger)">⚠️ Vyplň oba údaje</span>';
    return;
  }

  status.innerHTML = "⏳ Pripájam k FinCRM cloudu...";

  try {
    dbClient = window.supabase.createClient(url, key);
    const { error } = await dbClient.from("contacts").select("id").limit(1);
    if (error) throw error;

    localStorage.setItem("fincrm_sb_url", url);
    localStorage.setItem("fincrm_sb_key", key);

    status.innerHTML =
      '<span style="color:var(--accent3)">✓ Úspešne pripojené!</span>';
    setTimeout(() => {
      document.getElementById("setup-screen").style.display = "none";
      initApp();
    }, 800);
  } catch (err) {
    status.innerHTML = `<span style="color:var(--danger)">⚠️ Chyba: Skontrolujte údaje</span>`;
  }
}

// ========== NAČÍTANIE DÁT ==========
async function loadData() {
  if (!dbClient) return;
  showLoading("Aktualizujem dáta...");
  try {
    const [c, i, t] = await Promise.all([
      dbClient.from("contacts").select("*").order("name"),
      dbClient
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false }),
      dbClient
        .from("transactions")
        .select("*")
        .order("date", { ascending: false }),
    ]);

    data.contacts = c.data || [];
    data.invoices = i.data || [];
    data.transactions = t.data || [];

    setSyncStatus("ok");
    renderAll();
  } catch (err) {
    setSyncStatus("error");
  } finally {
    hideLoading();
  }
}

// ========== NAVIGÁCIA (Kompatibilná s tvojím Topbarom) ==========
const pageTitles = {
  dashboard: "Dashboard",
  contacts: "Kontakty & Firmy",
  invoices: "Fakturačný systém",
  transactions: "Cashflow & Financie",
  reports: "Prehľady a Analýzy",
};

const pageActions = {
  dashboard: "",
  contacts:
    '<button class="btn btn-primary" onclick="openModal(\'contact-modal\')">+ Nový kontakt</button>',
  invoices:
    '<button class="btn btn-primary" onclick="openModal(\'invoice-modal\')">+ Nová faktúra</button>',
  transactions:
    '<button class="btn btn-primary" onclick="openModal(\'transaction-modal\')">+ Nová transakcia</button>',
};

function showPage(name) {
  // 1. Skryť všetky strany a deaktivovať menu
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));

  // 2. Aktivovať vybranú stranu
  const target = document.getElementById("page-" + name);
  if (target) target.classList.add("active");

  // 3. Zmeniť nadpis a VLOŽIŤ TLAČIDLÁ
  document.getElementById("page-title").textContent = pageTitles[name] || name;
  const actionsContainer = document.getElementById("topbar-actions");

  if (actionsContainer) {
    // Tu sa vkladá HTML kód tlačidla (napr. <button onclick="openModal(...)">)
    actionsContainer.innerHTML = pageActions[name] || "";
  }

  // 4. Zvýrazniť aktívny riadok v sidebare
  document.querySelectorAll(".nav-item").forEach((n) => {
    if (n.getAttribute("onclick")?.includes(`'${name}'`)) {
      n.classList.add("active");
    }
  });

  renderAll();
}

// Táto funkcia spracuje formulár a pošle dáta do Supabase
async function saveContact(event) {
  event.preventDefault(); // Dôležité: zabráni znovunačítaniu stránky

  const formData = new FormData(event.target);
  const newContact = Object.fromEntries(formData.entries());

  showLoading("Ukladám kontakt do databázy...");

  try {
    // dbClient je tvoje pripojenie na Supabase, ktoré sme definovali skôr
    const { error } = await dbClient.from("contacts").insert([newContact]);

    if (error) throw error;

    // Ak uloženie prebehlo v poriadku:
    closeModal("contact-modal"); // Zavrie okno
    event.target.reset(); // Vymaže text z políčok
    await loadData(); // Okamžite refreshne tabuľku s novými dátami
  } catch (err) {
    console.error("Chyba:", err);
    alert("Nepodarilo sa uložiť kontakt: " + err.message);
  } finally {
    hideLoading();
  }
}

// ========== RENDERING ==========
function renderAll() {
  renderDashboard();
  renderContacts();
  // Tu môžeš doplniť renderInvoices a renderTransactions
}

function renderDashboard() {
  const income = data.transactions
    .filter((t) => t.type === "Príjem")
    .reduce((s, t) => s + t.amount, 0);
  const expenses = data.transactions
    .filter((t) => t.type === "Výdavok")
    .reduce((s, t) => s + t.amount, 0);
  const unpaid = data.invoices
    .filter((i) => i.status !== "Zaplatená")
    .reduce((s, i) => s + i.total, 0);

  const update = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  update("stat-income", fmt(income));
  update("stat-expenses", fmt(expenses));
  update("stat-profit", fmt(income - expenses));
  update("stat-unpaid", fmt(unpaid));

  // Top klienti vizualizácia
  const clientTotals = {};
  data.invoices
    .filter((i) => i.status === "Zaplatená")
    .forEach((i) => {
      clientTotals[i.client] = (clientTotals[i.client] || 0) + i.total;
    });
  const sorted = Object.entries(clientTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const max = sorted[0]?.[1] || 1;

  const clientDiv = document.getElementById("dash-clients");
  if (clientDiv) {
    clientDiv.innerHTML =
      sorted
        .map(
          ([name, total]) => `
      <div style="margin-bottom: 16px">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px">
          <span style="font-size:14px; font-weight:500">${name}</span>
          <span class="amount pos">${fmt(total)}</span>
        </div>
        <div style="height:6px; background:var(--surface2); border-radius:10px">
          <div style="width:${(total / max) * 100}%; height:100%; background:var(--accent); border-radius:10px"></div>
        </div>
      </div>`,
        )
        .join("") ||
      '<p style="color:var(--muted); font-size:13px">Žiadne dáta</p>';
  }
}

function renderContacts() {
  const tbody = document.querySelector("#page-contacts table tbody");
  if (!tbody) return;
  tbody.innerHTML = data.contacts
    .map(
      (c) => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.email || "—"}</td>
      <td>${c.phone || "—"}</td>
      <td><span class="badge badge-client">${c.type}</span></td>
      <td>${c.ico || "—"}</td>
      <td class="action-btns">
        <button class="btn btn-ghost" style="padding: 4px 8px">✏️</button>
        <button class="btn btn-danger" style="padding: 4px 8px" onclick="deleteEntry('contacts', ${c.id})">🗑️</button>
      </td>
    </tr>`,
    )
    .join("");
}

// ========== POMOCNÉ FUNKCIE (UI) ==========
function fmt(n) {
  return (
    new Intl.NumberFormat("sk-SK", { minimumFractionDigits: 2 }).format(
      n || 0,
    ) + " €"
  );
}

// MODAL OVLÁDANIE (Používa tvoju triedu .open)
function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

function showLoading(msg) {
  const l = document.getElementById("loading-overlay");
  if (l) {
    l.classList.add("show");
    document.getElementById("loading-text").textContent = msg;
  }
}
function hideLoading() {
  document.getElementById("loading-overlay")?.classList.remove("show");
}

function setSyncStatus(s) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = s === "ok" ? "● Online" : "✕ Offline";
}

// ========== INICIALIZÁCIA ==========
async function initApp() {
  const url = localStorage.getItem("fincrm_sb_url");
  const key = localStorage.getItem("fincrm_sb_key");
  if (url && key) {
    const setup = document.getElementById("setup-screen");
    if (setup) setup.style.display = "none";
    dbClient = window.supabase.createClient(url, key);
    await loadData();
    showPage("dashboard");
  }
}

window.addEventListener("DOMContentLoaded", initApp);
