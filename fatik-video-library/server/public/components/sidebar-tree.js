import { state } from "../state.js";
import { escapeHtml } from "../utils.js";

function renderNode(node, currentPath) {
    const isActive = node.relativePath === currentPath;

    const childrenHtml = Array.isArray(node.children) && node.children.length
        ? `<div class="tree-children">${node.children.map((child) => renderNode(child, currentPath)).join("")}</div>`
        : "";

    return `
    <div class="tree-item">
      <a
        class="tree-node ${isActive ? "active" : ""}"
        href="#/folder/${encodeURIComponent(node.relativePath || "")}"
      >
        ${escapeHtml(node.name)}
      </a>
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

    root.innerHTML = `
    <div class="sidebar-title">Library</div>
    <div class="tree">
      ${renderNode(tree, state.currentFolderPath)}
    </div>
  `;
}