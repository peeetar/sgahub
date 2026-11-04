// The small building blocks the marketing tools draw with.
import { h } from "./dom.js";

export function relative(iso) {
  if (!iso) return "never";
  const s = Math.abs(Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function chip(text, kind = "neutral") {
  return h(`span.chip.${kind}`, {}, text);
}

export function empty(title, text, action) {
  return h("div.empty-state", {}, h("b", {}, title), text ? h("p", {}, text) : null, action || null);
}

export function segmented(options, value, onChange, label = "") {
  const wrap = h("div.seg", { role: "group", "aria-label": label });
  for (const option of options) {
    const [key, text] = Array.isArray(option) ? option : [option, option];
    wrap.append(h("button", {
      type: "button", "aria-pressed": key === value ? "true" : "false", dataset: { key },
      onclick: () => {
        for (const b of wrap.children) b.setAttribute("aria-pressed", String(b.dataset.key === key));
        onChange(key);
      },
    }, text));
  }
  return wrap;
}

/** A form field: label, control, optional hint. */
export function field(label, control, hint) {
  return h("label.f", {}, h("span", {}, label), control, hint ? h("em", {}, hint) : null);
}

/** Disable a button while `promise` runs, so a tap always gets feedback. */
export async function busy(button, promise) {
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    return await promise;
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = false;
  }
}

let toastEl = null, toastTimer = null;

export function toast(message) {
  if (!toastEl) {
    toastEl = h("div.mk-toast", { role: "status" });
    document.body.append(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("on"), 2600);
}

/** A side sheet for detail views. Returns {el, close}. Dialogs live on <body>,
    so each one carries .mkroot for the styles. */
export function sheet(title, ...content) {
  const dialog = h("dialog.sheet.mkroot", { "aria-label": title },
    h("header.sheet-head", {}, h("h2", {}, title),
      h("button.linkish", { type: "button", onclick: () => dialog.close() }, "Close")),
    h("div.sheet-body", {}, ...content));
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { el: dialog, close: () => dialog.close() };
}

/** Ask before doing something. Resolves true or false. */
export function confirmDialog({ title, body, confirm = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const go = h(`button.btn${danger ? ".danger" : ""}`, { type: "submit" }, confirm);
    const form = h("form.confirm", { method: "dialog" },
      h("h2", {}, title),
      body ? h("p", {}, body) : null,
      h("div.row.end", {}, h("button.btn.ghost", { type: "button", onclick: () => dialog.close("no") }, "Cancel"), go));
    const dialog = h("dialog.dialog.mkroot", {}, form);
    form.addEventListener("submit", (e) => { e.preventDefault(); dialog.close("yes"); });
    dialog.addEventListener("close", () => { resolve(dialog.returnValue === "yes"); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
    go.focus();
  });
}

export async function loadJSZip() {
  return (await import("jszip")).default;
}
