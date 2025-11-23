from flask import Flask, request, render_template_string, redirect, url_for, Response
import os
import zipfile
import uuid
import json
import re
import subprocess
import signal
import errno
import time
from datetime import datetime
from typing import Optional, Dict, Any, List

app = Flask(__name__)

# Umbrel монтирует: ${APP_DATA_DIR}/data:/data
DATA_BASE_DIR = "/data"
PROJECTS_DIR = os.path.join(DATA_BASE_DIR, "projects")
VENVS_DIR = os.path.join(DATA_BASE_DIR, "venvs")
LOGS_DIR = os.path.join(DATA_BASE_DIR, "logs")
STATE_FILE = os.path.join(DATA_BASE_DIR, "runner.json")
DJANGO_PORT = 9000

os.makedirs(PROJECTS_DIR, exist_ok=True)
os.makedirs(VENVS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)


# ---------- Работа с состоянием ----------

def load_state() -> Dict[str, Any]:
    if not os.path.exists(STATE_FILE):
        return {"projects": []}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"projects": []}


def save_state(state: Dict[str, Any]) -> None:
    tmp_file = STATE_FILE + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp_file, STATE_FILE)


# ---------- Утилиты ----------

def find_first(root: str, filename: str) -> Optional[str]:
    for dirpath, dirnames, filenames in os.walk(root):
        if filename in filenames:
            return os.path.join(dirpath, filename)
    return None


def detect_settings_module(manage_path: str, project_root: str) -> Optional[str]:
    try:
        with open(manage_path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception:
        return None

    m = re.search(r"DJANGO_SETTINGS_MODULE[\"']\s*,\s*[\"']([^\"']+)[\"']", text)
    if m:
        return m.group(1)

    settings_path = find_first(project_root, "settings.py")
    if not settings_path:
        return None

    rel = os.path.relpath(settings_path, project_root)
    if rel.endswith(".py"):
        rel = rel[:-3]
    return rel.replace(os.sep, ".")


def tail_file(path: str, lines: int = 100) -> str:
    if not path or not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            data = f.readlines()
        return "".join(data[-lines:])
    except Exception:
        return ""


def get_python_from_venv(venv_path: str) -> str:
    if venv_path:
        cand = os.path.join(venv_path, "bin", "python")
        if os.path.exists(cand):
            return cand
        cand_win = os.path.join(venv_path, "Scripts", "python.exe")
        if os.path.exists(cand_win):
            return cand_win
    return "python"


def register_project(root_dir: str, zip_filename: str) -> Dict[str, Any]:
    manage_py = find_first(root_dir, "manage.py")
    requirements = find_first(root_dir, "requirements.txt")
    env_file = find_first(root_dir, ".env")
    settings_module = detect_settings_module(manage_py, root_dir) if manage_py else None

    if manage_py:
        project_name = os.path.basename(os.path.dirname(manage_py))
    else:
        project_name = os.path.splitext(os.path.basename(zip_filename))[0]

    project_id = os.path.basename(root_dir)
    venv_path = os.path.join(VENVS_DIR, project_id)

    project = {
        "id": project_id,
        "name": project_name,
        "root_dir": root_dir,
        "manage_py": manage_py,
        "settings_module": settings_module,
        "env_file": env_file,
        "requirements": requirements,
        "venv_path": venv_path,
        "requirements_installed": False,
        "last_error": None,
        "run_pid": None,
        "is_running": False,
        "started_at": None,  # timestamp запуска
        "log_file": os.path.join(LOGS_DIR, f"{project_id}.log"),
    }

    state = load_state()
    state["projects"] = [p for p in state["projects"] if p.get("id") != project_id]
    state["projects"].append(project)
    save_state(state)

    return project


def stop_running_project(project: Dict[str, Any]) -> bool:
    pid = project.get("run_pid")
    if not pid:
        project["is_running"] = False
        project["run_pid"] = None
        project["started_at"] = None
        return False
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError as e:
        if e.errno != errno.ESRCH:
            project["last_error"] = f"Stop error: {e}"
            return False
    project["run_pid"] = None
    project["is_running"] = False
    project["started_at"] = None
    return True


def format_uptime(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    sec = int(seconds)
    if sec < 60:
        return f"{sec} s"
    minutes, sec = divmod(sec, 60)
    if minutes < 60:
        return f"{minutes} m {sec} s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours} h {minutes} m"
    days, hours = divmod(hours, 24)
    return f"{days} d {hours} h"

# ---------- Шаблон ----------

INDEX_TEMPLATE = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Django Runner</title>
    <style>
      :root {
        --bg: #0f172a;
        --bg-card: #111827;
        --accent: #3b82f6;
        --accent-soft: rgba(59,130,246,0.15);
        --border: #1f2937;
        --text: #f9fafb;
        --muted: #9ca3af;
        --danger: #ef4444;
        --success: #22c55e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        background: radial-gradient(circle at top, #111827 0, #020617 55%, #000 100%);
        color: var(--text);
      }
      .page {
        max-width: 1100px;
        margin: 0 auto;
        padding: 2rem 1.5rem 3rem;
      }
      h1 {
        font-size: 2rem;
        margin-bottom: 0.25rem;
      }
      .subtitle {
        color: var(--muted);
        font-size: 0.95rem;
        margin-bottom: 2rem;
      }
      .card {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 1.25rem 1.5rem;
        box-shadow: 0 18px 40px rgba(15,23,42,0.65);
      }
      .upload-area {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      input[type="file"] {
        color: var(--muted);
        max-width: 260px;
      }
      button, .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        padding: 0.45rem 0.85rem;
        border-radius: 999px;
        border: none;
        background: var(--accent);
        color: #fff;
        font-size: 0.9rem;
        cursor: pointer;
        text-decoration: none;
        transition: transform .08s ease, box-shadow .08s ease, background .15s ease;
        box-shadow: 0 8px 20px rgba(37,99,235,0.45);
      }
      button:hover, .btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 30px rgba(37,99,235,0.6);
        background: #2563eb;
      }
      button:disabled {
        opacity: .45;
        cursor: default;
        box-shadow: none;
        transform: none;
      }
      .btn-secondary {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--muted);
        box-shadow: none;
      }
      .btn-secondary:hover {
        border-color: var(--accent);
        color: var(--text);
        background: rgba(15,23,42,0.8);
      }
      .btn-danger {
        background: rgba(248,113,113,0.15);
        color: #fecaca;
        box-shadow: none;
        border: 1px solid rgba(248,113,113,0.4);
      }
      .btn-danger:hover {
        background: rgba(248,113,113,0.25);
      }
      .section-title {
        margin-top: 2.2rem;
        margin-bottom: 0.75rem;
        font-size: 1.15rem;
      }
      .muted {
        color: var(--muted);
        font-size: 0.88rem;
      }
      .projects-grid {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .project-card {
        background: var(--bg-card);
        border-radius: 18px;
        border: 1px solid var(--border);
        padding: 1.1rem 1.3rem 1.2rem;
        position: relative;
      }
      .project-card.running {
        border-color: rgba(34,197,94,0.8);
        box-shadow: 0 0 0 1px rgba(34,197,94,0.3), 0 16px 35px rgba(22,163,74,0.35);
      }
      .project-header {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        margin-bottom: 0.35rem;
      }
      .project-name {
        font-weight: 600;
      }
      .project-id {
        font-size: 0.8rem;
        color: var(--muted);
      }
      .status-badge {
        font-size: 0.72rem;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        border: 1px solid transparent;
        margin-left: auto;
      }
      .status-running {
        background: rgba(34,197,94,0.1);
        border-color: rgba(34,197,94,0.7);
        color: #bbf7d0;
      }
      .status-stopped {
        background: rgba(148,163,184,0.08);
        border-color: rgba(148,163,184,0.45);
        color: var(--muted);
      }
      .project-meta {
        font-size: 0.82rem;
        line-height: 1.4;
        margin-bottom: 0.4rem;
      }
      .error {
        color: #fecaca;
        font-size: 0.8rem;
        margin-top: 0.25rem;
      }
      .project-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-top: 0.6rem;
        align-items: center;
      }
      .log-box {
        margin-top: 0.7rem;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: radial-gradient(circle at top left, rgba(148,163,184,0.08), rgba(15,23,42,0.95));
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 0.78rem;
        padding: 0.55rem 0.7rem;
        max-height: 180px;
        overflow: auto;
        white-space: pre-wrap;
      }
      .log-title {
        font-size: 0.75rem;
        color: var(--muted);
        margin-bottom: 0.25rem;
      }
      .hint {
        margin-top: 0.4rem;
        font-size: 0.78rem;
        color: var(--muted);
      }
      @media (max-width: 720px) {
        .page { padding: 1.5rem 1rem 2.5rem; }
        .project-actions { flex-direction: column; align-items: stretch; }
        button, .btn { width: 100%; justify-content: center; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <h1>Django Runner</h1>
      <div class="subtitle">
        Upload the ZIP file with the Django project, install the dependencies, and run it directly on Umbrel.
      </div>

      <div class="card" style="margin-bottom:1.5rem;">
        <h2 class="section-title" style="margin-top:0;">Upload Django project (ZIP)</h2>
        <form class="upload-area" action="{{ url_for('upload_zip') }}" method="post" enctype="multipart/form-data">
          <input type="file" name="zip_file" accept=".zip" required>
          <button type="submit">Upload</button>
          <span class="muted">The archive must contain <code>manage.py</code>, <code>settings.py</code> and (preferably) <code>requirements.txt</code>.</span>
        </form>
      </div>

      <h2 class="section-title">Projects</h2>
      {% if not projects %}
        <p class="muted">No projects have been uploaded yet.</p>
      {% else %}
        <div class="projects-grid">
          {% for p in projects %}
            <div class="project-card {% if p.is_running %}running{% endif %}">
              <div class="project-header">
                <div class="project-name">{{ p.name }}</div>
                <div class="project-id">({{ p.id }})</div>
                {% if p.is_running %}
                  <span class="status-badge status-running">Launched</span>
                {% else %}
                  <span class="status-badge status-stopped">Stopped</span>
                {% endif %}
              </div>

              <div class="project-meta muted">
                Root folder: {{ p.root_dir }}<br>
                manage.py: {{ p.manage_py or "not found" }}<br>
                settings: {{ p.settings_module or "undetermined" }}<br>
                .env: {{ p.env_file or "not found" }}<br>
                requirements.txt: {{ p.requirements or "not found" }}<br>
                PID: {{ p.run_pid or "—" }}, uptime: {{ p.uptime }}<br>
                Dependencies: {{ "installed" if p.requirements_installed else "not established" }}
              </div>

              {% if p.last_error %}
                <div class="error">Last error: {{ p.last_error }}</div>
              {% endif %}

              <div class="project-actions">
                <form action="{{ url_for('install_requirements', project_id=p.id) }}" method="post">
                  <button type="submit">Establish dependencies</button>
                </form>

                <form action="{{ url_for('start_project', project_id=p.id) }}" method="post">
                  <button type="submit"
                    {% if not p.manage_py or not p.requirements_installed %}disabled{% endif %}>
                    Start
                  </button>
                </form>

                <form action="{{ url_for('stop_project', project_id=p.id) }}" method="post">
                  <button type="submit" class="btn-secondary" {% if not p.is_running %}disabled{% endif %}>
                    Stop
                  </button>
                </form>

                <a class="btn-secondary"
                   href="http://{{ request_host }}:{{ django_port }}/"
                   target="_blank"
                   rel="noopener noreferrer">
                  Go to Django
                </a>

                                <a class="btn-secondary"
                                   href="{{ url_for('project_logs', project_id=p.id) }}"
                                   target="_blank"
                                   rel="noopener noreferrer">
                                  Open logs
                                </a>

                <form action="{{ url_for('delete_project', project_id=p.id) }}" method="post"
                      onsubmit="return confirm('Delete the project along with the files, venv, and logs?');">
                  <button type="submit" class="btn-danger">Delete project</button>
                </form>
              </div>

              <div class="log-box">
                <div class="log-title">Log (last {{ p.log_lines }} lines):</div>
                <div>{{ p.log_tail or "No logs yet — try running the project." }}</div>
              </div>
            </div>
          {% endfor %}
        </div>
        <div class="hint">
          Tip: Only one project can be launched at a time. When a new one is launched, the old one will be stopped.
        </div>
      {% endif %}
    </div>
  </body>
</html>
"""

LOG_PAGE_TEMPLATE = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Logs {{ project.name }}</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        background: #020617;
        color: #e5e7eb;
      }
      .page {
        max-width: 1000px;
        margin: 0 auto;
        padding: 1.5rem 1.25rem 2rem;
      }
      h1 {
        font-size: 1.4rem;
        margin-bottom: 0.2rem;
      }
      .muted {
        color: #9ca3af;
        font-size: 0.85rem;
        margin-bottom: 0.9rem;
      }
      .log-box {
        border-radius: 10px;
        border: 1px solid #1f2937;
        background: #020617;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 0.8rem;
        padding: 0.6rem 0.8rem;
        max-height: 80vh;
        overflow: auto;
        white-space: pre-wrap;
      }
      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      button {
        padding: 0.35rem 0.7rem;
        border-radius: 999px;
        border: 1px solid #374151;
        background: #020617;
        color: #e5e7eb;
        font-size: 0.8rem;
        cursor: pointer;
      }
      button:hover {
        background: #111827;
      }
      .status {
        font-size: 0.8rem;
        color: #9ca3af;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <h1>Logs: {{ project.name }}</h1>
      <div class="muted">{{ project.root_dir }}</div>
      <div class="toolbar">
        <div class="status">
          Updates every 3 seconds. PID: {{ project.run_pid or "—" }},
          status: {{ "launched" if project.is_running else "stopped" }}.
        </div>
        <button id="btn-refresh">Update</button>
      </div>
      <div id="log" class="log-box">Loading logs...</div>
    </div>

    <script>
      const logEl = document.getElementById('log');
      const btn = document.getElementById('btn-refresh');
      let autoScroll = true;

      logEl.addEventListener('scroll', () => {
        const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
        autoScroll = nearBottom;
      });

      async function loadLog() {
        try {
          const res = await fetch('{{ url_for("logs_tail", project_id=project.id) }}?lines=500', {cache: "no-store"});
          const text = await res.text();
          logEl.textContent = text || "Лог пуст.";
          if (autoScroll) {
            logEl.scrollTop = logEl.scrollHeight;
          }
        } catch (e) {
          logEl.textContent = "Log upload error: " + e;
        }
      }

      btn.addEventListener('click', loadLog);
      loadLog();
      setInterval(loadLog, 3000);
    </script>
  </body>
</html>
"""


# ---------- Роуты ----------

@app.route("/")
def index():
    state = load_state()
    projects = state.get("projects", [])

    now = time.time()

    # подтягиваем хвост логов и считаем uptime
    for p in projects:
        log_path = p.get("log_file")
        p["log_tail"] = tail_file(log_path, lines=100)
        p["log_lines"] = 100

        started_at = p.get("started_at")
        if p.get("is_running") and started_at:
            p["uptime"] = format_uptime(now - float(started_at))
        else:
            p["uptime"] = "—"

    request_host = request.host.split(":")[0]  # umbrel.local или IP
    return render_template_string(
        INDEX_TEMPLATE,
        projects=projects,
        request_host=request_host,
        django_port=DJANGO_PORT,
    )


@app.route("/upload", methods=["POST"])
def upload_zip():
    if "zip_file" not in request.files:
        return "File not found in request (zip_file field expected)", 400

    zip_file = request.files["zip_file"]

    if zip_file.filename == "":
        return "Empty file name", 400

    project_id = str(uuid.uuid4())
    project_root = os.path.join(PROJECTS_DIR, project_id)
    os.makedirs(project_root, exist_ok=True)

    zip_path = os.path.join(project_root, "upload.zip")
    zip_file.save(zip_path)

    try:
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(project_root)
    except zipfile.BadZipFile:
        return "Error: The uploaded file is not a valid ZIP archive.", 400
    finally:
        if os.path.exists(zip_path):
            os.remove(zip_path)

    register_project(project_root, zip_file.filename)
    return redirect(url_for("index"))


@app.route("/projects/<project_id>/install", methods=["POST"])
def install_requirements(project_id: str):
    state = load_state()
    project = next((p for p in state.get("projects", []) if p.get("id") == project_id), None)
    if not project:
        return f"Project {project_id} not found", 404

    req_path = project.get("requirements")
    if not req_path or not os.path.exists(req_path):
        project["last_error"] = "requirements.txt not found for this project"
        save_state(state)
        return redirect(url_for("index"))

    venv_path = project.get("venv_path") or os.path.join(VENVS_DIR, project_id)
    os.makedirs(os.path.dirname(venv_path), exist_ok=True)

    try:
        if not os.path.exists(venv_path):
            subprocess.check_call(["python", "-m", "venv", venv_path])

        python_exe = get_python_from_venv(venv_path)

        subprocess.check_call([python_exe, "-m", "pip", "install", "-r", req_path])
        subprocess.check_call([python_exe, "-m", "pip", "install", "gunicorn"])

        project["venv_path"] = venv_path
        project["requirements_installed"] = True
        project["last_error"] = None
    except subprocess.CalledProcessError as e:
        project["requirements_installed"] = False
        project["last_error"] = f"Ошибка установки зависимостей: {e}"
    except Exception as e:
        project["requirements_installed"] = False
        project["last_error"] = f"Неожиданная ошибка: {e}"

    state["projects"] = [p if p.get("id") != project_id else project for p in state.get("projects", [])]
    save_state(state)

    return redirect(url_for("index"))


@app.route("/projects/<project_id>/stop", methods=["POST"])
def stop_project(project_id):
    state = load_state()
    projects = state.get("projects", [])
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return "Project not found", 404

    stop_running_project(project)

    state["projects"] = [p if p.get("id") != project_id else project for p in projects]
    save_state(state)
    return redirect(url_for("index"))


@app.route("/projects/<project_id>/start", methods=["POST"])
def start_project(project_id):
    state = load_state()
    projects = state.get("projects", [])
    project = next((p for p in projects if p.get("id") == project_id), None)

    if not project:
        return "Project not found", 404

    manage_py = project.get("manage_py")
    settings_module = project.get("settings_module")
    venv_path = project.get("venv_path")
    root_dir = project.get("root_dir")

    if not manage_py or not settings_module:
        project["last_error"] = "manage.py or settings not found"
        save_state(state)
        return redirect(url_for("index"))

    project_base = os.path.dirname(manage_py)

    # Останавливаем все другие проекты
    for p in projects:
        if p.get("id") != project_id and p.get("is_running"):
            stop_running_project(p)

    # путь к wsgi.py
    wsgi_path = find_first(root_dir, "wsgi.py")
    if not wsgi_path:
        project["last_error"] = "Not found wsgi.py"
        save_state(state)
        return redirect(url_for("index"))

    rel = os.path.relpath(wsgi_path, project_base)
    wsgi_module = rel.replace("/", ".").replace("\\", ".").replace(".py", "")

    env = os.environ.copy()
    env["DJANGO_SETTINGS_MODULE"] = settings_module

    if project.get("env_file"):
        try:
            with open(project["env_file"], "r") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    env[k] = v
        except Exception as e:
            project["last_error"] = f"Reading error .env: {e}"

    python_exe = get_python_from_venv(venv_path)

    # collectstatic
    try:
        subprocess.check_call(
            [python_exe, os.path.basename(manage_py), "collectstatic", "--noinput"],
            cwd=project_base,
            env=env,
        )
    except subprocess.CalledProcessError as e:
        project["last_error"] = f"collectstatic ended with an error: {e}"

    # gunicorn
    log_path = project.get("log_file") or os.path.join(LOGS_DIR, f"{project_id}.log")
    project["log_file"] = log_path
    log_file = open(log_path, "a", buffering=1)

    cmd = [
        python_exe,
        "-m", "gunicorn",
        "--chdir", project_base,
        f"{wsgi_module}:application",
        "-b", f"0.0.0.0:{DJANGO_PORT}",
        "--workers", "3",
        "--log-file", "-",
        "--capture-output",
    ]

    try:
        process = subprocess.Popen(cmd, env=env, stdout=log_file, stderr=log_file)
        project["run_pid"] = process.pid
        project["is_running"] = True
        project["started_at"] = time.time()
    except Exception as e:
        project["is_running"] = False
        project["last_error"] = f"Gunicorn startup error: {e}"

    state["projects"] = [p if p.get("id") != project_id else project for p in projects]
    save_state(state)

    return redirect(url_for("index"))


@app.route("/projects/<project_id>/delete", methods=["POST"])
def delete_project(project_id: str):
    state = load_state()
    projects: List[Dict[str, Any]] = state.get("projects", [])
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return redirect(url_for("index"))

    # останавливаем, если запущен
    if project.get("is_running"):
        stop_running_project(project)

    # удаляем файлы
    import shutil
    try:
        if project.get("root_dir") and os.path.exists(project["root_dir"]):
            shutil.rmtree(project["root_dir"], ignore_errors=True)
        if project.get("venv_path") and os.path.exists(project["venv_path"]):
            shutil.rmtree(project["venv_path"], ignore_errors=True)
        if project.get("log_file") and os.path.exists(project["log_file"]):
            os.remove(project["log_file"])
    except Exception:
        # намеренно глушим, чтобы не сломать UI; можно писать в отдельный системный лог
        pass

    # чистим из runner.json
    state["projects"] = [p for p in projects if p.get("id") != project_id]
    save_state(state)

    return redirect(url_for("index"))

@app.route("/projects/<project_id>/logs")
def project_logs(project_id: str):
    state = load_state()
    projects: List[Dict[str, Any]] = state.get("projects", [])
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return "Project not found", 404

    return render_template_string(
        LOG_PAGE_TEMPLATE,
        project=project,
    )


@app.route("/projects/<project_id>/logs/tail")
def logs_tail(project_id: str):
    state = load_state()
    projects: List[Dict[str, Any]] = state.get("projects", [])
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return Response("Project not found\n", status=404, mimetype="text/plain")

    lines = request.args.get("lines", default="500")
    try:
        lines_int = int(lines)
    except ValueError:
        lines_int = 500

    text = tail_file(project.get("log_file"), lines=lines_int)
    return Response(text, mimetype="text/plain")

@app.route("/health")
def health():
    return "ok"
