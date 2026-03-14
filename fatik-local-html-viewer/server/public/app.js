let selectedProject = null;

const els = {
  projectsList: document.getElementById("projects-list"),
  refreshProjectsBtn: document.getElementById("refresh-projects-btn"),
  newProjectName: document.getElementById("new-project-name"),
  createProjectBtn: document.getElementById("create-project-btn"),

  projectEmpty: document.getElementById("project-empty"),
  projectPanel: document.getElementById("project-panel"),
  projectTitle: document.getElementById("project-title"),
  openProjectLink: document.getElementById("open-project-link"),
  downloadProjectLink: document.getElementById("download-project-link"),

  renameProjectInput: document.getElementById("rename-project-input"),
  renameProjectBtn: document.getElementById("rename-project-btn"),

  mainFileSelect: document.getElementById("main-file-select"),
  saveMainFileBtn: document.getElementById("save-main-file-btn"),

  folderInput: document.getElementById("folder-input"),
  uploadFolderBtn: document.getElementById("upload-folder-btn"),

  zipInput: document.getElementById("zip-input"),
  uploadZipBtn: document.getElementById("upload-zip-btn"),

  deleteProjectBtn: document.getElementById("delete-project-btn"),
  filesList: document.getElementById("files-list"),

  toast: document.getElementById("toast")
};

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  els.toast.classList.toggle("error", isError);

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2500);
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;

  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadProjects() {
  const data = await api("/api/projects");
  const projects = data.projects || [];

  if (!projects.length) {
    els.projectsList.innerHTML = `<div class="muted">No projects yet</div>`;
    return;
  }

  els.projectsList.innerHTML = projects.map((p) => {
    const active = selectedProject === p.name ? "project-item active" : "project-item";
    return `
      <button class="${active}" data-project="${escapeHtml(p.name)}">
        <div class="project-item-title">${escapeHtml(p.name)}</div>
        <div class="project-item-sub">
          main: ${escapeHtml(p.mainFile || "index.html")} · files: ${p.filesCount}
        </div>
      </button>
    `;
  }).join("");

  els.projectsList.querySelectorAll("[data-project]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      selectedProject = btn.dataset.project;
      await loadProjects();
      await loadProjectDetails(selectedProject);
    });
  });
}

async function loadProjectDetails(name) {
  const data = await api(`/api/projects/${encodeURIComponent(name)}`);
  const p = data.project;

  els.projectEmpty.classList.add("hidden");
  els.projectPanel.classList.remove("hidden");

  els.projectTitle.textContent = p.name;
  els.renameProjectInput.value = p.name;
  els.openProjectLink.href = `/view/${encodeURIComponent(p.name)}`;
  els.downloadProjectLink.href = `/api/projects/${encodeURIComponent(p.name)}/download`;

  renderMainFiles(p.htmlFiles || [], p.mainFile);
  renderFiles(p.files || []);
}

function renderMainFiles(htmlFiles, mainFile) {
  if (!htmlFiles.length) {
    els.mainFileSelect.innerHTML = `<option value="">HTML files not found</option>`;
    return;
  }

  els.mainFileSelect.innerHTML = htmlFiles.map((file) => {
    const selected = file === mainFile ? "selected" : "";
    return `<option value="${escapeHtml(file)}" ${selected}>${escapeHtml(file)}</option>`;
  }).join("");
}

function renderFiles(files) {
  if (!files.length) {
    els.filesList.innerHTML = `<div class="muted">No files found</div>`;
    return;
  }

  els.filesList.innerHTML = files.map((f) => {
    const cls = f.type === "dir" ? "file-row dir" : "file-row";
    const size = f.type === "file" ? formatBytes(f.size) : "folder";
    const preview =
      f.type === "file" && f.path.toLowerCase().endsWith(".html")
        ? `<a class="mini-link" target="_blank" href="/project/${encodeURIComponent(selectedProject)}/${f.path.split('/').map(encodeURIComponent).join('/')}">открыть файл</a>`
        : "";

    return `
      <div class="${cls}">
        <div class="file-path">${escapeHtml(f.path)}</div>
        <div class="file-size">${escapeHtml(size)}</div>
        <div class="file-action">${preview}</div>
      </div>
    `;
  }).join("");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

els.createProjectBtn.addEventListener("click", async () => {
  try {
    const name = els.newProjectName.value.trim();
    if (!name) {
      showToast("Enter project name", true);
      return;
    }

    const data = await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    selectedProject = data.project.name;
    els.newProjectName.value = "";
    await loadProjects();
    await loadProjectDetails(selectedProject);
    showToast("Project created");
  } catch (err) {
    showToast(err.message, true);
  }
});

els.refreshProjectsBtn.addEventListener("click", async () => {
  try {
    await loadProjects();
    if (selectedProject) {
      await loadProjectDetails(selectedProject);
    }
    showToast("List updated");
  } catch (err) {
    showToast(err.message, true);
  }
});

els.renameProjectBtn.addEventListener("click", async () => {
  try {
    if (!selectedProject) return;
    const newName = els.renameProjectInput.value.trim();
    if (!newName) {
      showToast("Choose new name", true);
      return;
    }

    const data = await api(`/api/projects/${encodeURIComponent(selectedProject)}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName })
    });

    selectedProject = data.project.name;
    await loadProjects();
    await loadProjectDetails(selectedProject);
    showToast("Проект переименован");
  } catch (err) {
    showToast(err.message, true);
  }
});

els.saveMainFileBtn.addEventListener("click", async () => {
  try {
    if (!selectedProject) return;

    const mainFile = els.mainFileSelect.value;
    if (!mainFile) {
      showToast("No HTML file to select", true);
      return;
    }

    await api(`/api/projects/${encodeURIComponent(selectedProject)}/main-file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mainFile })
    });

    await loadProjects();
    await loadProjectDetails(selectedProject);
    showToast("Main file saved");
  } catch (err) {
    showToast(err.message, true);
  }
});

els.uploadFolderBtn.addEventListener("click", async () => {
  try {
    if (!selectedProject) {
      showToast("First, select a project", true);
      return;
    }

    const files = Array.from(els.folderInput.files || []);
    if (!files.length) {
      showToast("Select folder", true);
      return;
    }

    const form = new FormData();

    for (const file of files) {
      const relPath = file.webkitRelativePath || file.name;
      form.append("files", file, relPath);
    }

    await api(`/api/projects/${encodeURIComponent(selectedProject)}/upload-folder`, {
      method: "POST",
      body: form
    });

    els.folderInput.value = "";
    await loadProjects();
    await loadProjectDetails(selectedProject);
    showToast("Folder uploaded");
  } catch (err) {
    showToast(err.message, true);
  }
});

els.uploadZipBtn.addEventListener("click", async () => {
  try {
    if (!selectedProject) {
      showToast("First, choose a project", true);
      return;
    }

    const file = els.zipInput.files?.[0];
    if (!file) {
      showToast("Select ZIP-file", true);
      return;
    }

    const form = new FormData();
    form.append("zip", file);

    await api(`/api/projects/${encodeURIComponent(selectedProject)}/upload-zip`, {
      method: "POST",
      body: form
    });

    els.zipInput.value = "";
    await loadProjects();
    await loadProjectDetails(selectedProject);
    showToast("ZIP uploaded");
  } catch (err) {
    showToast(err.message, true);
  }
});

els.deleteProjectBtn.addEventListener("click", async () => {
  try {
    if (!selectedProject) return;

    const ok = confirm(`Delete project "${selectedProject}"?`);
    if (!ok) return;

    await api(`/api/projects/${encodeURIComponent(selectedProject)}`, {
      method: "DELETE"
    });

    selectedProject = null;
    els.projectPanel.classList.add("hidden");
    els.projectEmpty.classList.remove("hidden");

    await loadProjects();
    showToast("Project deleted");
  } catch (err) {
    showToast(err.message, true);
  }
});

(async function init() {
  try {
    await loadProjects();
  } catch (err) {
    showToast(err.message, true);
  }
})();