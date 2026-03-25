import { state } from "../state.js";
import { escapeHtml } from "../utils.js";

function getFolderChain(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  const chain = [""];
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    chain.push(current);
  }

  return chain;
}

function ensureCurrentPathExpanded() {
  const chain = getFolderChain(state.currentFolderPath);
  for (const part of chain) {
    state.expandedFolders.add(part);
  }
}

function isExpanded(relativePath) {
  return state.expandedFolders.has(relativePath);
}

function toggleExpanded(relativePath) {
  if (state.expandedFolders.has(relativePath)) {
    state.expandedFolders.delete(relativePath);
  } else {
    state.expandedFolders.add(relativePath);
  }
}

function renderNode(node, currentPath) {
  const isActive = node.relativePath === currentPath;
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const expanded = hasChildren ? isExpanded(node.relativePath) : false;

  const childrenHtml =
    hasChildren && expanded
      ? `<div class="tree-children">${node.children
          .map((child) => renderNode(child, currentPath))
          .join("")}</div>`
      : "";

  return `
    <div class="tree-item">
      <div class="tree-row">
        ${
          hasChildren
            ? `<button
                class="tree-toggle"
                type="button"
                data-path="${escapeHtml(node.relativePath)}"
                aria-label="${expanded ? "Collapse folder" : "Expand folder"}"
              >
                ${expanded ? "▾" : "▸"}
              </button>`
            : `<span class="tree-toggle tree-toggle-placeholder"></span>`
        }

        <a
          class="tree-node ${isActive ? "active" : ""}"
          href="#/folder/${encodeURIComponent(node.relativePath || "")}"
        >
          ${escapeHtml(node.name)}
        </a>
      </div>
      ${childrenHtml}
    </div>
  `;
}

export function renderSidebarTree(root) {
  const tree = state.tree;

  if (!tree) {
    root.innerHTML = `<div class="sidebar-title">Library</div><div class="empty-state">Library is not loaded yet.</div>`;
    return;
  }

  ensureCurrentPathExpanded();

  root.innerHTML = `
    <div class="sidebar-title">Library</div>
    <div class="tree">
      ${renderNode(tree, state.currentFolderPath)}
    </div>
  `;

  root.querySelectorAll(".tree-toggle[data-path]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const relativePath = button.dataset.path || "";
      toggleExpanded(relativePath);
      renderSidebarTree(root);
    });
  });
}