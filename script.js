// ========== SUPABASE ==========
let dbClient = null;

async function connectSupabase() {
  const url = document.getElementById("sb-url").value.trim();
  const key = document.getElementById("sb-key").value.trim();
  const status = document.getElementById("setup-status");

  if (!url || !key) {
    status.innerHTML =
      '<span style="color:var(--danger)">⚠️ Vyplň oba polia</span>';
    return;
  }

  status.innerHTML = "⏳ Pripájam...";

  try {
    dbClient = window.supabase.createClient(url, key);
    const { error } = await dbClient.from("contacts").select("id").limit(1);

    localStorage.setItem("fincrm_sb_url", url);
    localStorage.setItem("fincrm_sb_key", key);

    status.innerHTML = '<span style="color:var(--accent3)">✓ Pripojené!</span>';
    setTimeout(() => {
      document.getElementById("setup-screen").classList.add("hidden");
      initApp();
    }, 600);
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span style="color:var(--danger)">⚠️ Chyba: ${err.message || "Skontroluj URL a kľúč"}</span>`;
  }
}

function setSyncStatus(state) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  if (state === "ok") {
    el.className = "sync-badge";
    el.textContent = "● Online";
  } else if (state === "syncing") {
    el.className = "sync-badge syncing";
    el.textContent = "⟳ Ukladám...";
  } else {
    el.className = "sync-badge error";
    el.textContent = "✕ Offline";
  }
}

// ========== DATA ==========
let data = { contacts: [], invoices: [], transactions: [] };
let editingId = null;
let editingType = null;
let deleteCallback = null;

async function loadData() {
  showLoading("Načítavam dáta zo Supabase...");
  try {
    const [c, i, t] = await Promise.all([
      supabase.from("contacts").select("*").order("id"),
      supabase.from("invoices").select("*").order("id"),
      supabase.from("transactions").select("*").order("id"),
    ]);
    if (c.error) throw c.error;
    if (i.error) throw i.error;
    if (t.error) throw t.error;
    data.contacts = c.data || [];
    data.invoices = i.data || [];
    data.transactions = t.data || [];
    setSyncStatus("ok");
  } catch (err) {
    console.error(err);
    setSyncStatus("error");
    showToast("Chyba pri načítaní dát: " + err.message, true);
  } finally {
    hideLoading();
  }
}

async function saveData() {
  // no-op: all saves go directly through Supabase calls
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map((x) => x.id)) + 1 : 1;
}

function showLoading(msg = "Načítavam...") {
  document.getElementById("loading-text").textContent = msg;
  document.getElementById("loading-overlay").classList.add("show");
}
function hideLoading() {
  document.getElementById("loading-overlay").classList.remove("show");
}

// ========== NAVIGATION ==========
const pageTitles = {
  dashboard: "Dashboard",
  contacts: "Kontakty & Firmy",
  invoices: "Faktúry",
  transactions: "Príjmy & Výdavky",
  reports: "Prehľady",
};

const pageActions = {
  dashboard: "",
  contacts:
    '<button class="btn btn-primary" onclick="openContactModal()">+ Nový kontakt</button>',
  invoices:
    '<button class="btn btn-primary" onclick="openInvoiceModal()">+ Nová faktúra</button>',
  transactions:
    '<button class="btn btn-primary" onclick="openTransactionModal()">+ Nová transakcia</button>',
  reports: "",
};

function showPage(name) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  document.getElementById("page-title").textContent = pageTitles[name];
  document.getElementById("topbar-actions").innerHTML = pageActions[name];
  document.querySelectorAll(".nav-item").forEach((n) => {
    if (
      n.textContent
        .trim()
        .toLowerCase()
        .includes(pageTitles[name].toLowerCase().split(" ")[0].toLowerCase()) ||
      (name === "dashboard" && n.textContent.includes("Dashboard"))
    ) {
      n.classList.add("active");
    }
  });
  // re-set active by onclick
  document.querySelectorAll(".nav-item").forEach((n) => {
    const onclick = n.getAttribute("onclick");
    if (onclick && onclick.includes("'" + name + "'"))
      n.classList.add("active");
  });
  renderAll();
}

// ========== RENDER ==========
function fmt(n) {
  return (
    new Intl.NumberFormat("sk-SK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n) + " €"
  );
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("sk-SK");
}

function statusBadge(s) {
  const map = {
    Zaplatená: "paid",
    Odoslaná: "pending",
    "Po splatnosti": "overdue",
    Návrh: "draft",
  };
  return `<span class="badge badge-${map[s] || "draft"}">${s}</span>`;
}

function renderAll() {
  renderDashboard();
  renderContacts();
  renderInvoices();
  renderTransactions();
  renderReports();
}

function renderDashboard() {
  const income = data.transactions
    .filter((t) => t.type === "Príjem")
    .reduce((s, t) => s + t.amount, 0);
  const expenses = data.transactions
    .filter((t) => t.type === "Výdavok")
    .reduce((s, t) => s + t.amount, 0);
  const profit = income - expenses;
  const unpaid = data.invoices
    .filter((i) => i.status === "Odoslaná" || i.status === "Po splatnosti")
    .reduce((s, i) => s + i.total, 0);

  document.getElementById("stat-income").textContent = fmt(income);
  document.getElementById("stat-expenses").textContent = fmt(expenses);
  document.getElementById("stat-profit").textContent = fmt(profit);
  document.getElementById("stat-unpaid").textContent = fmt(unpaid);

  const pct = income > 0 ? ((profit / income) * 100).toFixed(1) : 0;
  const el = document.getElementById("stat-profit-pct");
  el.textContent = `Marža: ${pct}%`;
  el.className = "stat-change" + (profit < 0 ? " neg" : "");

  // Chart
  renderBarChart("dash-chart");

  // Recent invoices
  const inv = [...data.invoices].reverse().slice(0, 4);
  document.getElementById("dash-invoices").innerHTML = inv.length
    ? inv
        .map(
          (i) =>
            `<div class="recent-item">
      <div><div class="recent-name">${i.number}</div><div class="recent-sub">${i.client}</div></div>
      <div style="text-align:right">${statusBadge(i.status)}<div style="font-family:'DM Mono',monospace;font-size:13px;margin-top:4px">${fmt(i.total)}</div></div>
    </div>`,
        )
        .join("")
    : '<div class="empty-state"><p>Žiadne faktúry</p></div>';

  // Recent transactions
  const tx = [...data.transactions].reverse().slice(0, 4);
  document.getElementById("dash-transactions").innerHTML = tx.length
    ? tx
        .map(
          (t) =>
            `<div class="recent-item">
      <div><div class="recent-name">${t.desc}</div><div class="recent-sub">${fmtDate(t.date)} · ${t.category}</div></div>
      <div class="amount ${t.type === "Príjem" ? "pos" : "neg"}">${t.type === "Príjem" ? "+" : "-"}${fmt(t.amount)}</div>
    </div>`,
        )
        .join("")
    : '<div class="empty-state"><p>Žiadne transakcie</p></div>';

  // Top clients
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
  document.getElementById("dash-clients").innerHTML = sorted.length
    ? sorted
        .map(
          ([name, total]) =>
            `<div class="recent-item" style="flex-direction:column;align-items:flex-start;gap:6px">
      <div style="display:flex;justify-content:space-between;width:100%">
        <span style="font-weight:500;font-size:14px">${name}</span>
        <span class="amount pos">${fmt(total)}</span>
      </div>
      <div class="progress-bar" style="width:100%"><div class="progress-fill" style="width:${((total / max) * 100).toFixed(0)}%"></div></div>
    </div>`,
        )
        .join("")
    : '<div class="empty-state"><p>Žiadne dáta</p></div>';
}

function renderBarChart(containerId) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Máj",
    "Jún",
    "Júl",
    "Aug",
    "Sep",
    "Okt",
    "Nov",
    "Dec",
  ];
  const monthlyIncome = new Array(12).fill(0);
  const monthlyExpense = new Array(12).fill(0);

  data.transactions.forEach((t) => {
    const m = new Date(t.date).getMonth();
    if (t.type === "Príjem") monthlyIncome[m] += t.amount;
    else monthlyExpense[m] += t.amount;
  });

  const maxVal = Math.max(...monthlyIncome, ...monthlyExpense, 1);
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = months
    .map((m, i) => {
      const ih = ((monthlyIncome[i] / maxVal) * 140).toFixed(0);
      const eh = ((monthlyExpense[i] / maxVal) * 140).toFixed(0);
      return `<div class="bar-group">
      <div style="display:flex;gap:2px;align-items:flex-end">
        <div class="bar bar-income" style="height:${ih}px;width:10px" title="Príjmy: ${fmt(monthlyIncome[i])}"></div>
        <div class="bar bar-expense" style="height:${eh}px;width:10px" title="Výdavky: ${fmt(monthlyExpense[i])}"></div>
      </div>
      <div class="bar-label">${m}</div>
    </div>`;
    })
    .join("");
}

function renderContacts(filter = "") {
  const list = data.contacts.filter(
    (c) =>
      !filter ||
      c.name.toLowerCase().includes(filter) ||
      c.email.toLowerCase().includes(filter),
  );
  document.getElementById("contacts-count").textContent = list.length;
  document.getElementById("contacts-tbody").innerHTML = list.length
    ? list
        .map(
          (c) =>
            `<tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.email || "—"}</td>
      <td>${c.phone || "—"}</td>
      <td><span class="badge ${c.type === "Klient" ? "badge-client" : c.type === "Dodávateľ" ? "badge-pending" : "badge-draft"}">${c.type}</span></td>
      <td style="font-family:'DM Mono',monospace;font-size:12px">${c.ico || "—"}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" onclick="editContact(${c.id})">✏️</button>
          <button class="btn btn-danger" style="padding:5px 10px;font-size:12px" onclick="deleteRecord('contacts', ${c.id})">🗑️</button>
        </div>
      </td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><p>Žiadne kontakty. Klikni na "Nový kontakt".</p></div></td></tr>`;
}

function renderInvoices(filter = "") {
  const list = data.invoices.filter(
    (i) =>
      !filter ||
      i.number.toLowerCase().includes(filter) ||
      i.client.toLowerCase().includes(filter),
  );
  document.getElementById("invoices-count").textContent = list.length;
  document.getElementById("invoices-tbody").innerHTML = list.length
    ? [...list]
        .reverse()
        .map(
          (i) =>
            `<tr>
      <td style="font-family:'DM Mono',monospace;font-weight:500">${i.number}</td>
      <td>${i.client}</td>
      <td>${fmtDate(i.date)}</td>
      <td>${fmtDate(i.due)}</td>
      <td class="amount">${fmt(i.total)}</td>
      <td>${statusBadge(i.status)}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" onclick="editInvoice(${i.id})">✏️</button>
          ${i.status !== "Zaplatená" ? `<button class="btn btn-success" style="padding:5px 10px;font-size:12px" onclick="markPaid(${i.id})">✓</button>` : ""}
          <button class="btn btn-danger" style="padding:5px 10px;font-size:12px" onclick="deleteRecord('invoices', ${i.id})">🗑️</button>
        </div>
      </td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🧾</div><p>Žiadne faktúry. Klikni na "Nová faktúra".</p></div></td></tr>`;
}

function renderTransactions(filter = "") {
  const list = data.transactions.filter(
    (t) =>
      !filter ||
      t.desc.toLowerCase().includes(filter) ||
      t.category.toLowerCase().includes(filter),
  );
  document.getElementById("transactions-count").textContent = list.length;
  document.getElementById("transactions-tbody").innerHTML = list.length
    ? [...list]
        .reverse()
        .map(
          (t) =>
            `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:13px">${fmtDate(t.date)}</td>
      <td><strong>${t.desc}</strong></td>
      <td><span class="badge badge-draft">${t.category}</span></td>
      <td>${t.contact || "—"}</td>
      <td class="amount ${t.type === "Príjem" ? "pos" : "neg"}">${t.type === "Príjem" ? "+" : "-"}${fmt(t.amount)}</td>
      <td><span class="badge ${t.type === "Príjem" ? "badge-income" : "badge-expense"}">${t.type}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" onclick="editTransaction(${t.id})">✏️</button>
          <button class="btn btn-danger" style="padding:5px 10px;font-size:12px" onclick="deleteRecord('transactions', ${t.id})">🗑️</button>
        </div>
      </td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">💰</div><p>Žiadne transakcie. Klikni na "Nová transakcia".</p></div></td></tr>`;
}

function renderReports() {
  const income = data.transactions
    .filter((t) => t.type === "Príjem")
    .reduce((s, t) => s + t.amount, 0);
  const expenses = data.transactions
    .filter((t) => t.type === "Výdavok")
    .reduce((s, t) => s + t.amount, 0);
  const profit = income - expenses;
  const margin = income > 0 ? (profit / income) * 100 : 0;

  document.getElementById("rep-income").textContent = fmt(income);
  document.getElementById("rep-expenses").textContent = fmt(expenses);
  document.getElementById("rep-profit").textContent = fmt(profit);
  document.getElementById("rep-margin").textContent = margin.toFixed(1) + "%";

  const maxVal = Math.max(income, expenses);
  if (maxVal > 0) {
    document.getElementById("rep-expense-bar").style.width =
      (expenses / maxVal) * 100 + "%";
    document.getElementById("rep-profit-bar").style.width =
      (Math.max(0, profit) / maxVal) * 100 + "%";
    document.getElementById("rep-margin-bar").style.width =
      Math.max(0, margin) + "%";
  }

  renderBarChart("rep-chart");

  // Categories
  const cats = {};
  data.transactions
    .filter((t) => t.type === "Výdavok")
    .forEach((t) => {
      cats[t.category] = (cats[t.category] || 0) + t.amount;
    });
  const sortedCats = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const maxCat = sortedCats[0]?.[1] || 1;
  document.getElementById("category-breakdown").innerHTML = sortedCats.length
    ? sortedCats
        .map(
          ([cat, amt]) => `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:13px">${cat}</span>
          <span class="amount neg" style="font-size:13px">${fmt(amt)}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${((amt / maxCat) * 100).toFixed(0)}%;background:var(--danger)"></div></div>
      </div>`,
        )
        .join("")
    : '<p style="color:var(--muted);font-size:14px">Žiadne výdavky</p>';

  // Invoice status
  const statuses = { Zaplatená: 0, Odoslaná: 0, "Po splatnosti": 0, Návrh: 0 };
  data.invoices.forEach((i) => {
    if (statuses[i.status] !== undefined) statuses[i.status] += i.total;
  });
  document.getElementById("invoice-status-report").innerHTML = Object.entries(
    statuses,
  )
    .map(
      ([s, v]) =>
        `<div style="flex:1;min-width:140px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-family:'DM Mono',monospace;letter-spacing:1px;text-transform:uppercase">${s}</div>
      <div style="font-family:'DM Serif Display',serif;font-size:24px">${fmt(v)}</div>
      ${statusBadge(s)}
    </div>`,
    )
    .join("");
}

// ========== MODALS ==========
function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  editingId = null;
  editingType = null;
}

function openContactModal() {
  editingId = null;
  document.getElementById("modal-contact-title").textContent = "Nový kontakt";
  [
    "c-name",
    "c-email",
    "c-phone",
    "c-ico",
    "c-dic",
    "c-address",
    "c-note",
  ].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("c-type").value = "Klient";
  openModal("modal-contact");
}

function editContact(id) {
  const c = data.contacts.find((x) => x.id === id);
  if (!c) return;
  editingId = id;
  document.getElementById("modal-contact-title").textContent =
    "Upraviť kontakt";
  document.getElementById("c-name").value = c.name;
  document.getElementById("c-email").value = c.email;
  document.getElementById("c-phone").value = c.phone;
  document.getElementById("c-type").value = c.type;
  document.getElementById("c-ico").value = c.ico;
  document.getElementById("c-dic").value = c.dic;
  document.getElementById("c-address").value = c.address;
  document.getElementById("c-note").value = c.note;
  openModal("modal-contact");
}

async function saveContact() {
  const name = document.getElementById("c-name").value.trim();
  if (!name) return showToast("Zadaj meno kontaktu!", true);
  const obj = {
    name,
    email: document.getElementById("c-email").value,
    phone: document.getElementById("c-phone").value,
    type: document.getElementById("c-type").value,
    ico: document.getElementById("c-ico").value,
    dic: document.getElementById("c-dic").value,
    address: document.getElementById("c-address").value,
    note: document.getElementById("c-note").value,
  };
  setSyncStatus("syncing");
  try {
    if (editingId) {
      const { error } = await supabase
        .from("contacts")
        .update(obj)
        .eq("id", editingId);
      if (error) throw error;
      const idx = data.contacts.findIndex((x) => x.id === editingId);
      data.contacts[idx] = { ...data.contacts[idx], ...obj };
    } else {
      const { data: rows, error } = await supabase
        .from("contacts")
        .insert(obj)
        .select();
      if (error) throw error;
      data.contacts.push(rows[0]);
    }
    setSyncStatus("ok");
    closeModal("modal-contact");
    renderAll();
    showToast(editingId ? "Kontakt aktualizovaný" : "Kontakt pridaný");
  } catch (err) {
    setSyncStatus("error");
    showToast("Chyba: " + err.message, true);
  }
}

function populateClientSelect(selectedVal = "") {
  const sel = document.getElementById("i-client");
  sel.innerHTML =
    data.contacts
      .filter((c) => c.type === "Klient" || c.type === "Partner")
      .map(
        (c) =>
          `<option value="${c.name}" ${c.name === selectedVal ? "selected" : ""}>${c.name}</option>`,
      )
      .join("") || '<option value="">— pridaj kontakt —</option>';
}

function populateContactSelect(selectedVal = "") {
  const sel = document.getElementById("t-contact");
  sel.innerHTML =
    '<option value="">— bez kontaktu —</option>' +
    data.contacts
      .map(
        (c) =>
          `<option value="${c.name}" ${c.name === selectedVal ? "selected" : ""}>${c.name}</option>`,
      )
      .join("");
}

function openInvoiceModal() {
  editingId = null;
  document.getElementById("modal-invoice-title").textContent = "Nová faktúra";
  const today = new Date().toISOString().split("T")[0];
  const due = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
  const num = "FAK-2025-" + String(data.invoices.length + 1).padStart(3, "0");
  document.getElementById("i-number").value = num;
  document.getElementById("i-type").value = "Faktúra";
  document.getElementById("i-date").value = today;
  document.getElementById("i-due").value = due;
  document.getElementById("i-amount").value = "";
  document.getElementById("i-total").value = "";
  document.getElementById("i-vat").value = "20";
  document.getElementById("i-status").value = "Návrh";
  document.getElementById("i-items").value = "";
  document.getElementById("i-note").value = "";
  populateClientSelect();
  openModal("modal-invoice");
}

function editInvoice(id) {
  const i = data.invoices.find((x) => x.id === id);
  if (!i) return;
  editingId = id;
  document.getElementById("modal-invoice-title").textContent =
    "Upraviť faktúru";
  document.getElementById("i-number").value = i.number;
  document.getElementById("i-type").value = i.type;
  document.getElementById("i-date").value = i.date;
  document.getElementById("i-due").value = i.due;
  document.getElementById("i-amount").value = i.amount;
  document.getElementById("i-vat").value = i.vat;
  document.getElementById("i-total").value = i.total;
  document.getElementById("i-status").value = i.status;
  document.getElementById("i-items").value = i.items;
  document.getElementById("i-note").value = i.note;
  populateClientSelect(i.client);
  openModal("modal-invoice");
}

function calcVat() {
  const amt = parseFloat(document.getElementById("i-amount").value) || 0;
  const vat = parseFloat(document.getElementById("i-vat").value) || 0;
  document.getElementById("i-total").value = (amt * (1 + vat / 100)).toFixed(2);
}

async function saveInvoice() {
  const number = document.getElementById("i-number").value.trim();
  if (!number) return showToast("Zadaj číslo faktúry!", true);
  const amount = parseFloat(document.getElementById("i-amount").value) || 0;
  const vat = parseFloat(document.getElementById("i-vat").value) || 0;
  const obj = {
    number,
    type: document.getElementById("i-type").value,
    client: document.getElementById("i-client").value,
    date: document.getElementById("i-date").value,
    due: document.getElementById("i-due").value,
    items: document.getElementById("i-items").value,
    amount,
    vat,
    total: parseFloat((amount * (1 + vat / 100)).toFixed(2)),
    status: document.getElementById("i-status").value,
    note: document.getElementById("i-note").value,
  };
  setSyncStatus("syncing");
  try {
    if (editingId) {
      const { error } = await supabase
        .from("invoices")
        .update(obj)
        .eq("id", editingId);
      if (error) throw error;
      const idx = data.invoices.findIndex((x) => x.id === editingId);
      data.invoices[idx] = { ...data.invoices[idx], ...obj };
    } else {
      const { data: rows, error } = await supabase
        .from("invoices")
        .insert(obj)
        .select();
      if (error) throw error;
      data.invoices.push(rows[0]);
    }
    setSyncStatus("ok");
    closeModal("modal-invoice");
    renderAll();
    showToast(editingId ? "Faktúra aktualizovaná" : "Faktúra pridaná");
  } catch (err) {
    setSyncStatus("error");
    showToast("Chyba: " + err.message, true);
  }
}

async function markPaid(id) {
  setSyncStatus("syncing");
  try {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "Zaplatená" })
      .eq("id", id);
    if (error) throw error;
    const i = data.invoices.find((x) => x.id === id);
    if (i) i.status = "Zaplatená";
    setSyncStatus("ok");
    renderAll();
    showToast("Faktúra označená ako zaplatená ✓");
  } catch (err) {
    setSyncStatus("error");
    showToast("Chyba: " + err.message, true);
  }
}

function openTransactionModal() {
  editingId = null;
  document.getElementById("modal-transaction-title").textContent =
    "Nová transakcia";
  document.getElementById("t-date").value = new Date()
    .toISOString()
    .split("T")[0];
  document.getElementById("t-type").value = "Príjem";
  document.getElementById("t-desc").value = "";
  document.getElementById("t-amount").value = "";
  document.getElementById("t-note").value = "";
  document.getElementById("t-category").value = "Tržby";
  populateContactSelect();
  openModal("modal-transaction");
}

function editTransaction(id) {
  const t = data.transactions.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById("modal-transaction-title").textContent =
    "Upraviť transakciu";
  document.getElementById("t-date").value = t.date;
  document.getElementById("t-type").value = t.type;
  document.getElementById("t-desc").value = t.desc;
  document.getElementById("t-amount").value = t.amount;
  document.getElementById("t-note").value = t.note;
  document.getElementById("t-category").value = t.category;
  populateContactSelect(t.contact);
  openModal("modal-transaction");
}

async function saveTransaction() {
  const desc = document.getElementById("t-desc").value.trim();
  if (!desc) return showToast("Zadaj popis transakcie!", true);
  const amount = parseFloat(document.getElementById("t-amount").value) || 0;
  if (!amount) return showToast("Zadaj sumu!", true);
  const obj = {
    date: document.getElementById("t-date").value,
    type: document.getElementById("t-type").value,
    desc,
    category: document.getElementById("t-category").value,
    contact: document.getElementById("t-contact").value,
    amount,
    note: document.getElementById("t-note").value,
  };
  setSyncStatus("syncing");
  try {
    if (editingId) {
      const { error } = await supabase
        .from("transactions")
        .update(obj)
        .eq("id", editingId);
      if (error) throw error;
      const idx = data.transactions.findIndex((x) => x.id === editingId);
      data.transactions[idx] = { ...data.transactions[idx], ...obj };
    } else {
      const { data: rows, error } = await supabase
        .from("transactions")
        .insert(obj)
        .select();
      if (error) throw error;
      data.transactions.push(rows[0]);
    }
    setSyncStatus("ok");
    closeModal("modal-transaction");
    renderAll();
    showToast(editingId ? "Transakcia aktualizovaná" : "Transakcia pridaná");
  } catch (err) {
    setSyncStatus("error");
    showToast("Chyba: " + err.message, true);
  }
}

// ========== DELETE ==========
function deleteRecord(type, id) {
  deleteCallback = async () => {
    setSyncStatus("syncing");
    try {
      const { error } = await supabase.from(type).delete().eq("id", id);
      if (error) throw error;
      data[type] = data[type].filter((x) => x.id !== id);
      setSyncStatus("ok");
      renderAll();
      showToast("Záznam vymazaný");
    } catch (err) {
      setSyncStatus("error");
      showToast("Chyba: " + err.message, true);
    }
  };
  document.getElementById("confirm-overlay").classList.add("open");
}

function confirmDelete() {
  if (deleteCallback) deleteCallback();
  deleteCallback = null;
  closeConfirm();
}

function closeConfirm() {
  document.getElementById("confirm-overlay").classList.remove("open");
  deleteCallback = null;
}

// ========== FILTERS ==========
function filterContacts(v) {
  renderContacts(v.toLowerCase());
}
function filterInvoices(v) {
  renderInvoices(v.toLowerCase());
}
function filterTransactions(v) {
  renderTransactions(v.toLowerCase());
}

// ========== TOAST ==========
function showToast(msg, error = false) {
  const t = document.getElementById("toast");
  t.textContent = (error ? "⚠️ " : "✅ ") + msg;
  t.style.borderLeftColor = error ? "var(--danger)" : "var(--accent3)";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ========== CLOSE MODAL ON OVERLAY CLICK ==========
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", function (e) {
    if (e.target === this) {
      this.classList.remove("open");
      editingId = null;
    }
  });
});

// ========== INIT ==========
async function initApp() {
  await loadData();
  renderAll();
  showPage("dashboard");
}

// Auto-reconnect if credentials saved
(function () {
  const url = localStorage.getItem("fincrm_sb_url");
  const key = localStorage.getItem("fincrm_sb_key");
  if (url && key) {
    document.getElementById("sb-url").value = url;
    document.getElementById("sb-key").value = key;
    connectSupabase();
  }
})();
