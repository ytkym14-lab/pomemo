import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
const LS_CODE = "pm_code", LS_WHO = "pm_who", LS_STORE = "pm_store";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const strlen = (s) => Array.from(s).length;

const state = { stores: [], cats: [], items: [] };
const ui = { storeId: localStorage.getItem(LS_STORE) || null, edit: false };
let db = null, listId = null, who = "";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

// ---------- 起動 ----------
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function boot() {
  if (firebaseConfig.apiKey === "YOUR_API_KEY") { $("#config-missing").hidden = false; return; }
  const code = localStorage.getItem(LS_CODE);
  who = localStorage.getItem(LS_WHO) || "";
  if (!code || !who) { showSetup(); return; }
  $("#setup").hidden = true;
  $("#app").hidden = false;
  listId = await sha256hex("pm:" + code);
  const app = initializeApp(firebaseConfig);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const sub = (name, key) => onSnapshot(collection(db, "lists", listId, name), (snap) => {
    state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => toast("同期エラー: " + err.code));
  sub("stores", "stores"); sub("categories", "cats"); sub("items", "items");
  updateOnline();
  render();
}

function showSetup() {
  $("#app").hidden = true;
  $("#setup").hidden = false;
  $("#setup-code").value = localStorage.getItem(LS_CODE) || "";
  $("#setup-who").value = localStorage.getItem(LS_WHO) || "";
}

$("#setup-go").addEventListener("click", () => {
  const code = $("#setup-code").value.trim();
  const w = $("#setup-who").value.trim();
  const err = $("#setup-error");
  if (strlen(code) < 8) { err.textContent = "共有コードは8文字以上にしてください。"; return; }
  if (!w || strlen(w) > 2) { err.textContent = "表示はイニシャルか絵文字を1〜2文字で入力してください。"; return; }
  localStorage.setItem(LS_CODE, code);
  localStorage.setItem(LS_WHO, w);
  location.reload();
});

function updateOnline() { $("#offline").hidden = navigator.onLine; }
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);

// ---------- 部品 ----------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function modal({ title, message = "", body = "", buttons }) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${message ? `<div class="msg">${message}</div>` : ""}<div class="fields">${body}</div><div class="btns"></div></form>`;
  const form = d.querySelector("form");
  const btns = d.querySelector(".btns");
  const values = () => Object.fromEntries(Array.from(d.querySelectorAll("[name]")).map((el) => [el.name, el.value]));
  let primary = null;
  buttons.forEach((b) => {
    const el = document.createElement("button");
    el.type = "button"; el.textContent = b.label;
    if (b.cls) el.className = b.cls;
    if (b.cls === "primary") primary = el;
    el.addEventListener("click", () => {
      if (b.onClick && b.onClick(values(), d) === false) return;
      d.close();
    });
    btns.appendChild(el);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); if (primary) primary.click(); });
  d.addEventListener("close", () => d.remove());
  document.body.appendChild(d);
  d.showModal();
  const first = d.querySelector("input,select");
  if (first && !/iPhone|iPad/.test(navigator.userAgent)) first.focus();
  return d;
}

const confirmDialog = (title, message, okLabel, onOk, danger = true) =>
  modal({ title, message, buttons: [
    { label: "キャンセル" },
    { label: okLabel, cls: danger ? "primary danger" : "primary", onClick: () => { onOk(); } }
  ] });

function nextOrder(list) { return list.reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1; }
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const byCreated = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0);
const ref = (name, id) => doc(db, "lists", listId, name, id);

// ---------- データ操作 ----------
async function save(name, id, data) { setDoc(ref(name, id), data, { merge: true }).catch((e) => toast("保存エラー: " + e.code)); }
function patch(name, id, data) { updateDoc(ref(name, id), data).catch((e) => toast("保存エラー: " + e.code)); }
function commit(batch) { batch.commit().catch((e) => toast("保存エラー: " + e.code)); }

function toggleItem(item) {
  if (item.need) patch("items", item.id, { need: false, qty: 0 });
  else patch("items", item.id, { need: true, qty: 1, by: who });
}
function changeQty(item, delta) {
  const q = (item.qty || 1) + delta;
  if (q <= 0) patch("items", item.id, { need: false, qty: 0 });
  else patch("items", item.id, { qty: q });
}

function swapOrder(name, list, id, dir) {
  const sorted = list.slice().sort(byOrder);
  const i = sorted.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  // 同じorderが並んでも確実に入れ替わるよう、連番を振り直す
  const arr = sorted.map((x) => x.id);
  [arr[i], arr[j]] = [arr[j], arr[i]];
  const b = writeBatch(db);
  arr.forEach((aid, idx) => b.update(ref(name, aid), { order: idx + 1 }));
  commit(b);
}

function completeStore(store) {
  const mine = state.items.filter((i) => i.storeId === store.id);
  const needs = mine.filter((i) => !i.temp && i.need);
  const temps = mine.filter((i) => i.temp);
  if (!needs.length && !temps.length) { toast("戻す品物はありません"); return; }
  confirmDialog(
    "買い物完了",
    `「${esc(store.name)}」の必要な品物 ${needs.length} 件を「不要」に戻します。` +
      (temps.length ? `<br>臨時アイテム ${temps.length} 件は削除されます。` : ""),
    "完了にする",
    () => {
      const b = writeBatch(db);
      needs.forEach((i) => b.update(ref("items", i.id), { need: false, qty: 0 }));
      temps.forEach((i) => b.delete(ref("items", i.id)));
      commit(b);
      toast("買い物完了しました");
    }, false);
}

// ---------- 画面 ----------
function currentStore() {
  const stores = state.stores.slice().sort(byOrder);
  let s = stores.find((x) => x.id === ui.storeId);
  if (!s) s = stores[0] || null;
  ui.storeId = s ? s.id : null;
  return s;
}

function render() {
  if (!db) return;
  const stores = state.stores.slice().sort(byOrder);
  const store = currentStore();
  if (store) localStorage.setItem(LS_STORE, store.id);

  $("#btn-edit").classList.toggle("on", ui.edit);
  $("#btn-edit").textContent = ui.edit ? "編集中（完了）" : "編集";
  $("#btn-complete").disabled = !store;
  $("#btn-temp").disabled = !store;

  // タブ
  const counts = {};
  state.items.forEach((i) => { if (i.need) counts[i.storeId] = (counts[i.storeId] || 0) + 1; });
  $("#tabs").innerHTML = stores.map((s) =>
    `<button class="tab ${store && s.id === store.id ? "active" : ""}" data-action="tab" data-id="${s.id}">${esc(s.name)}<span class="badge">${counts[s.id] || 0}</span></button>`
  ).join("") + (ui.edit ? `<button class="tab add" data-action="add-store">＋ お店</button>` : "");

  // 店の編集ツール
  const tools = $("#store-tools");
  tools.hidden = !(ui.edit && store);
  if (!tools.hidden) {
    tools.innerHTML = `<button data-action="rename-store">店名を変更</button><button data-action="store-left">◀ 左へ</button><button data-action="store-right">右へ ▶</button><button class="danger" data-action="delete-store">この店を削除</button>`;
  }

  // 本体
  const c = $("#content");
  if (!store) {
    c.innerHTML = `<div class="empty">お店がまだありません。<br>右上の「編集」→「＋ お店」から、<br>よく行くお店を追加してください。</div>`;
    return;
  }
  const cats = state.cats.filter((x) => x.storeId === store.id).sort(byOrder);
  const items = state.items.filter((i) => i.storeId === store.id);
  let html = "";
  cats.forEach((cat) => {
    const list = items.filter((i) => !i.temp && i.categoryId === cat.id).sort(byCreated);
    html += `<div class="cat-head"><span class="name">${esc(cat.name)}</span>` +
      (ui.edit ? `<button data-action="cat-up" data-id="${cat.id}">▲</button><button data-action="cat-down" data-id="${cat.id}">▼</button><button data-action="rename-cat" data-id="${cat.id}">名前</button><button class="danger" data-action="delete-cat" data-id="${cat.id}">削除</button>` : "") +
      `</div><div class="grid">${list.map(tileHtml).join("")}` +
      (ui.edit ? `<button class="tile add-tile" data-action="add-item" data-id="${cat.id}">＋ 品物</button>` : "") + `</div>`;
  });
  const temps = items.filter((i) => i.temp).sort(byCreated);
  if (temps.length) {
    html += `<div class="cat-head"><span class="name">臨時</span></div><div class="grid">${temps.map(tileHtml).join("")}</div>`;
  }
  if (ui.edit) html += `<div class="grid" style="margin-top:18px"><button class="tile add-tile" data-action="add-cat">＋ カテゴリ</button></div>`;
  if (!cats.length && !temps.length && !ui.edit) html = `<div class="empty">カテゴリがまだありません。<br>「編集」から追加してください。</div>`;
  c.innerHTML = html;
}

function tileHtml(i) {
  const need = !!i.need;
  return `<div class="tile ${need ? "need" : ""}" role="button" tabindex="0" data-action="tile" data-id="${i.id}">` +
    `<span class="name">${esc(i.name)}</span>` +
    (need ? `<div class="row"><span class="qty"><button data-action="dec" data-id="${i.id}" aria-label="減らす">−</button><span>${i.qty || 1}</span><button data-action="inc" data-id="${i.id}" aria-label="増やす">＋</button></span><span class="by">${esc(i.by || "")}</span></div>` : "") +
    `</div>`;
}

// ---------- ダイアログ（追加・編集） ----------
function storeOptions(selected) {
  return state.stores.slice().sort(byOrder).map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}
function catOptions(storeId, selected) {
  return state.cats.filter((c) => c.storeId === storeId).sort(byOrder).map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

function addStore() {
  modal({ title: "お店を追加", body: `<label>お店の名前<input name="name" placeholder="例: 食料品店"></label>`, buttons: [
    { label: "キャンセル" },
    { label: "追加", cls: "primary", onClick: (v) => {
      if (!v.name.trim()) return false;
      const id = uid();
      save("stores", id, { name: v.name.trim(), order: nextOrder(state.stores) });
      ui.storeId = id;
    } }
  ] });
}
function renameStore(store) {
  modal({ title: "店名を変更", body: `<label>お店の名前<input name="name" value="${esc(store.name)}"></label>`, buttons: [
    { label: "キャンセル" },
    { label: "保存", cls: "primary", onClick: (v) => { if (!v.name.trim()) return false; patch("stores", store.id, { name: v.name.trim() }); } }
  ] });
}
function deleteStore(store) {
  const cats = state.cats.filter((c) => c.storeId === store.id);
  const items = state.items.filter((i) => i.storeId === store.id);
  confirmDialog("お店を削除", `「${esc(store.name)}」を削除します。<br>中のカテゴリ ${cats.length} 件・品物 ${items.length} 件も消えます。`, "削除する", () => {
    const b = writeBatch(db);
    items.forEach((i) => b.delete(ref("items", i.id)));
    cats.forEach((c) => b.delete(ref("categories", c.id)));
    b.delete(ref("stores", store.id));
    commit(b);
    ui.storeId = null;
  });
}

function addCat(store) {
  modal({ title: "カテゴリを追加", body: `<label>カテゴリ名<input name="name" placeholder="例: 野菜"></label>`, buttons: [
    { label: "キャンセル" },
    { label: "追加", cls: "primary", onClick: (v) => {
      if (!v.name.trim()) return false;
      save("categories", uid(), { storeId: store.id, name: v.name.trim(), order: nextOrder(state.cats.filter((c) => c.storeId === store.id)) });
    } }
  ] });
}
function renameCat(cat) {
  modal({ title: "カテゴリ名を変更", body: `<label>カテゴリ名<input name="name" value="${esc(cat.name)}"></label>`, buttons: [
    { label: "キャンセル" },
    { label: "保存", cls: "primary", onClick: (v) => { if (!v.name.trim()) return false; patch("categories", cat.id, { name: v.name.trim() }); } }
  ] });
}
function deleteCat(cat) {
  const items = state.items.filter((i) => i.categoryId === cat.id);
  confirmDialog("カテゴリを削除", `「${esc(cat.name)}」を削除します。<br>中の品物 ${items.length} 件も消えます。`, "削除する", () => {
    const b = writeBatch(db);
    items.forEach((i) => b.delete(ref("items", i.id)));
    b.delete(ref("categories", cat.id));
    commit(b);
  });
}

function addItem(cat) {
  modal({ title: `品物を追加（${cat.name}）`, body: `<label>品物の名前<input name="name" placeholder="例: 牛乳"></label>`, buttons: [
    { label: "キャンセル" },
    { label: "追加", cls: "primary", onClick: (v) => {
      if (!v.name.trim()) return false;
      save("items", uid(), { name: v.name.trim(), storeId: cat.storeId, categoryId: cat.id, need: false, qty: 0, by: "", temp: false, createdAt: Date.now() });
    } }
  ] });
}

function editItem(item) {
  const isTemp = !!item.temp;
  const d = modal({
    title: "品物を編集",
    body: `<label>名前<input name="name" value="${esc(item.name)}"></label>` +
      `<label>お店<select name="storeId">${storeOptions(item.storeId)}</select></label>` +
      (isTemp ? "" : `<label>カテゴリ<select name="categoryId">${catOptions(item.storeId, item.categoryId)}</select></label>`),
    buttons: [
      { label: "キャンセル" },
      { label: "削除", cls: "danger", onClick: () => {
        const name = item.name;
        setTimeout(() => confirmDialog("品物を削除", `「${esc(name)}」を削除します。`, "削除する", () => {
          const b = writeBatch(db); b.delete(ref("items", item.id)); commit(b);
        }), 0);
      } },
      { label: "保存", cls: "primary", onClick: (v) => {
        if (!v.name.trim()) return false;
        const data = { name: v.name.trim(), storeId: v.storeId };
        if (!isTemp) {
          if (!v.categoryId) { toast("お店にカテゴリがありません"); return false; }
          data.categoryId = v.categoryId;
        }
        patch("items", item.id, data);
      } }
    ]
  });
  const storeSel = d.querySelector('[name="storeId"]');
  const catSel = d.querySelector('[name="categoryId"]');
  if (catSel) storeSel.addEventListener("change", () => { catSel.innerHTML = catOptions(storeSel.value, null); });
}

function addTemp(store) {
  modal({
    title: "臨時アイテムを追加",
    message: "マスターには登録されず、「買い物完了」で消えます。",
    body: `<label>名前<input name="name" placeholder="例: 誕生日ケーキ"></label>` +
      `<label>お店<select name="storeId">${storeOptions(store.id)}</select></label>` +
      `<label>数量<input name="qty" type="number" min="1" value="1" inputmode="numeric"></label>`,
    buttons: [
      { label: "キャンセル" },
      { label: "追加", cls: "primary", onClick: (v) => {
        if (!v.name.trim()) return false;
        const qty = Math.max(1, parseInt(v.qty, 10) || 1);
        save("items", uid(), { name: v.name.trim(), storeId: v.storeId, categoryId: null, need: true, qty, by: who, temp: true, createdAt: Date.now() });
        ui.storeId = v.storeId;
      } }
    ]
  });
}

function openSettings() {
  modal({
    title: "設定",
    message: "共有コードを変更すると、別のリストに切り替わります。",
    body: `<label>共有コード<input name="code" value="${esc(localStorage.getItem(LS_CODE) || "")}" autocapitalize="off" spellcheck="false"></label>` +
      `<label>自分の表示（イニシャル・絵文字）<input name="who" value="${esc(who)}" maxlength="4"></label>`,
    buttons: [
      { label: "キャンセル" },
      { label: "保存", cls: "primary", onClick: (v) => {
        const code = v.code.trim(), w = v.who.trim();
        if (strlen(code) < 8) { toast("共有コードは8文字以上です"); return false; }
        if (!w || strlen(w) > 2) { toast("表示は1〜2文字です"); return false; }
        const changed = code !== localStorage.getItem(LS_CODE);
        localStorage.setItem(LS_CODE, code); localStorage.setItem(LS_WHO, w);
        if (changed) localStorage.removeItem(LS_STORE);
        location.reload();
      } }
    ]
  });
}

// ---------- イベント ----------
$("#btn-edit").addEventListener("click", () => { ui.edit = !ui.edit; render(); });
$("#btn-settings").addEventListener("click", openSettings);
$("#btn-temp").addEventListener("click", () => { const s = currentStore(); if (s) addTemp(s); });
$("#btn-complete").addEventListener("click", () => { const s = currentStore(); if (s) completeStore(s); });

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !db) return;
  const a = el.dataset.action, id = el.dataset.id;
  const store = currentStore();
  const item = state.items.find((i) => i.id === id);
  const cat = state.cats.find((c) => c.id === id);
  switch (a) {
    case "tab": ui.storeId = id; render(); break;
    case "add-store": addStore(); break;
    case "rename-store": store && renameStore(store); break;
    case "delete-store": store && deleteStore(store); break;
    case "store-left": store && swapOrder("stores", state.stores, store.id, -1); break;
    case "store-right": store && swapOrder("stores", state.stores, store.id, 1); break;
    case "add-cat": store && addCat(store); break;
    case "rename-cat": cat && renameCat(cat); break;
    case "delete-cat": cat && deleteCat(cat); break;
    case "cat-up": cat && swapOrder("categories", state.cats.filter((c) => c.storeId === cat.storeId), cat.id, -1); break;
    case "cat-down": cat && swapOrder("categories", state.cats.filter((c) => c.storeId === cat.storeId), cat.id, 1); break;
    case "add-item": cat && addItem(cat); break;
    case "tile": if (item) { ui.edit ? editItem(item) : toggleItem(item); } break;
    case "inc": item && changeQty(item, 1); break;
    case "dec": item && changeQty(item, -1); break;
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('.tile[data-action="tile"]')) { e.preventDefault(); e.target.click(); }
});

boot();
