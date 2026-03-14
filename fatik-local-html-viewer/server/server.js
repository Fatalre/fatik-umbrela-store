const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const unzipper = require("unzipper");
const archiver = require("archiver");
const sanitize = require("sanitize-filename");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PROJECTS_DIR = path.join(DATA_DIR, "projects");

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 512
  }
});

function safeName(name) {
  const cleaned = sanitize(String(name || "").trim());
  if (!cleaned) return null;
  return cleaned;
}

function projectPath(projectName) {
  return path.join(PROJECTS_DIR, projectName);
}

function ensureProjectExists(projectName) {
  const p = projectPath(projectName);
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
    throw new Error("Project not found");
  }
  return p;
}

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function ensureInsideOrEqual(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function listFilesRecursive(dir, baseDir = dir) {
  const items = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(baseDir, abs).replace(/\\/g, "/");
    const stat = fs.statSync(abs);

    if (entry.isDirectory()) {
      items.push({
        type: "dir",
        name: entry.name,
        path: rel,
        size: 0
      });
      items.push(...listFilesRecursive(abs, baseDir));
    } else {
      items.push({
        type: "file",
        name: entry.name,
        path: rel,
        size: stat.size
      });
    }
  }

  return items.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function findHtmlFiles(dir, baseDir = dir) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...findHtmlFiles(abs, baseDir));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      result.push(path.relative(baseDir, abs).replace(/\\/g, "/"));
    }
  }

  return result.sort((a, b) => a.localeCompare(b, "en"));
}

function getProjectMeta(projectDir) {
  const metaPath = path.join(projectDir, ".project.json");
  if (!fs.existsSync(metaPath)) {
    return {
      mainFile: "index.html",
      createdAt: new Date().toISOString()
    };
  }

  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return {
      mainFile: "index.html",
      createdAt: new Date().toISOString()
    };
  }
}

function saveProjectMeta(projectDir, meta) {
  const metaPath = path.join(projectDir, ".project.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

function getProjectInfo(projectName) {
  const dir = projectPath(projectName);
  const meta = getProjectMeta(dir);
  const htmlFiles = findHtmlFiles(dir);
  const files = listFilesRecursive(dir).filter((x) => x.path !== ".project.json");

  return {
    name: projectName,
    mainFile: meta.mainFile || "index.html",
    createdAt: meta.createdAt || null,
    htmlFiles,
    filesCount: files.length
  };
}

function createProject(projectName) {
  const name = safeName(projectName);
  if (!name) throw new Error("Invalid project name");

  const dir = projectPath(name);
  if (fs.existsSync(dir)) throw new Error("Project already exists");

  fs.mkdirSync(dir, { recursive: true });
  saveProjectMeta(dir, {
    mainFile: "index.html",
    createdAt: new Date().toISOString()
  });

  return name;
}

function removeRecursiveSafe(targetDir) {
  if (!ensureInsideOrEqual(PROJECTS_DIR, targetDir)) {
    throw new Error("Unsafe delete path");
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
}

function copyBufferToFile(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/projects", (req, res) => {
  const projects = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "en"))
    .map(getProjectInfo);

  res.json({ projects });
});

app.post("/api/projects", (req, res) => {
  try {
    const name = createProject(req.body.name);
    res.json({ ok: true, project: getProjectInfo(name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/projects/:name", (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);
    const meta = getProjectMeta(dir);
    const htmlFiles = findHtmlFiles(dir);
    const files = listFilesRecursive(dir).filter((x) => x.path !== ".project.json");

    res.json({
      project: {
        name,
        mainFile: meta.mainFile || "index.html",
        createdAt: meta.createdAt || null,
        htmlFiles,
        files
      }
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.put("/api/projects/:name/rename", (req, res) => {
  try {
    const oldName = safeName(req.params.name);
    const newName = safeName(req.body.newName);

    if (!oldName || !newName) throw new Error("Invalid project name");

    const oldDir = ensureProjectExists(oldName);
    const newDir = projectPath(newName);

    if (fs.existsSync(newDir)) {
      throw new Error("Target project already exists");
    }

    fs.renameSync(oldDir, newDir);

    res.json({
      ok: true,
      project: getProjectInfo(newName)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/projects/:name/main-file", (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);
    const requested = String(req.body.mainFile || "").replace(/\\/g, "/");
    if (!requested) throw new Error("Main file is required");

    const target = path.join(dir, requested);
    if (!ensureInsideOrEqual(dir, target)) {
      throw new Error("Unsafe path");
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error("Main file not found");
    }
    if (!requested.toLowerCase().endsWith(".html")) {
      throw new Error("Main file must be an HTML file");
    }

    const meta = getProjectMeta(dir);
    meta.mainFile = requested;
    saveProjectMeta(dir, meta);

    res.json({ ok: true, project: getProjectInfo(name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/projects/:name", (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);
    removeRecursiveSafe(dir);

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/projects/:name/upload-folder", upload.array("files", 5000), (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);
    const files = req.files || [];

    if (!files.length) {
      throw new Error("No files uploaded");
    }

    for (const file of files) {
      const relRaw =
        file.originalname ||
        file.fieldname ||
        "unknown";

      const rel = relRaw.replace(/\\/g, "/").replace(/^\/+/, "");
      const target = path.join(dir, rel);

      if (!ensureInsideOrEqual(dir, target)) {
        throw new Error(`Unsafe file path: ${rel}`);
      }

      copyBufferToFile(target, file.buffer);
    }

    const meta = getProjectMeta(dir);
    const htmlFiles = findHtmlFiles(dir);
    if ((!meta.mainFile || meta.mainFile === "index.html") && !fs.existsSync(path.join(dir, meta.mainFile))) {
      meta.mainFile = htmlFiles.includes("index.html") ? "index.html" : (htmlFiles[0] || "index.html");
      saveProjectMeta(dir, meta);
    }

    res.json({
      ok: true,
      project: getProjectInfo(name)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/projects/:name/upload-zip", upload.single("zip"), async (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);

    if (!req.file) {
      throw new Error("ZIP file is required");
    }

    const zipStream = unzipper.Parse();
    const stream = require("stream");
    const readable = new stream.PassThrough();
    readable.end(req.file.buffer);

    const entries = [];

    await new Promise((resolve, reject) => {
      readable
        .pipe(zipStream)
        .on("entry", (entry) => {
          const raw = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
          const target = path.join(dir, raw);

          if (!ensureInsideOrEqual(dir, target)) {
            entry.autodrain();
            return reject(new Error(`Unsafe ZIP path: ${raw}`));
          }

          if (entry.type === "Directory") {
            fs.mkdirSync(target, { recursive: true });
            entry.autodrain();
            entries.push(raw);
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            entry.pipe(fs.createWriteStream(target));
            entries.push(raw);
          }
        })
        .on("close", resolve)
        .on("error", reject);
    });

    const meta = getProjectMeta(dir);
    const htmlFiles = findHtmlFiles(dir);
    if (!htmlFiles.length) {
      throw new Error("ZIP uploaded, but no HTML files found");
    }

    if (!meta.mainFile || meta.mainFile === "index.html") {
      meta.mainFile = htmlFiles.includes("index.html") ? "index.html" : htmlFiles[0];
      saveProjectMeta(dir, meta);
    }

    res.json({
      ok: true,
      entriesCount: entries.length,
      project: getProjectInfo(name)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/projects/:name/download", (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(res);
    archive.directory(dir, false);
    archive.finalize();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/view/:name", (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);
    const meta = getProjectMeta(dir);
    const mainFile = meta.mainFile || "index.html";
    const target = path.join(dir, mainFile);

    if (!ensureInsideOrEqual(dir, target)) {
      throw new Error("Unsafe path");
    }
    if (!fs.existsSync(target)) {
      return res.status(404).send("Main HTML file not found");
    }

    res.sendFile(target);
  } catch (err) {
    res.status(404).send(err.message);
  }
});

app.get("/project-files/:name/*", (req, res) => {
  try {
    const name = safeName(req.params.name);
    if (!name) throw new Error("Invalid project name");

    const dir = ensureProjectExists(name);
    const rel = decodeURIComponent(req.params[0] || "").replace(/\\/g, "/");
    const target = path.join(dir, rel);

    if (!ensureInsideOrEqual(dir, target)) {
      throw new Error("Unsafe path");
    }

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return res.status(404).send("File not found");
    }

    res.sendFile(target);
  } catch (err) {
    res.status(404).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Local HTML Viewer running on port ${PORT}`);
});