import { escapeHtml } from "../utils.js";

export function renderEmptyState(title, text) {
    return `
    <div class="card empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}