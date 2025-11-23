from flask import Flask, request, render_template_string, redirect, url_for
import os
import zipfile
import uuid
import json
import re
import subprocess
from typing import Optional, Dict, Any
import signal

app = Flask(__name__)

# Umbrel монтирует том как: ${APP_DATA_DIR}/data:/data
DATA_BASE_DIR = "/data"
PROJECTS_DIR = os.path.join(DATA_BASE_DIR, "projects")
STATE_FILE = os.path.join(DATA_BASE_DIR, "runner.json")
LOGS_DIR = os.path.join(DATA_BASE_DIR, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

os.makedirs(PROJECTS_DIR, exist_ok=True)


# ---------- Работа с состоянием ----------

def load_state() -> Dict[str, Any]:
    if not os.path.exists(STATE_FILE):
        return {"projects": []}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        # если файл битый — не валим приложение
        return {"projects": []}


def save_state(state: Dict[str, Any]) -> None:
    tmp_file = STATE_FILE + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp_file, STATE_FILE)


def find_first(root: str, filename: str) -> Optional[str]:
    """Рекурсивно ищем первый файл с таким именем."""
    for dirpath, dirnames, filenames in os.walk(root):
        if filename in filenames:
            return os.path.join(dirpath, filename)
    return None


def detect_settings_module(manage_path: str, project_root: str) -> Optional[str]:
    """Пытаемся найти DJANGO_SETTINGS_MODULE, иначе строим его по пути settings.py."""
    try:
        with open(manage_path, "r", encoding="utf-8") as f:
            text = f.read()
    except Exception:
        return None

    # os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')
    m = re.search(r"DJANGO_SETTINGS_MODULE[\"']\s*,\s*[\"']([^\"']+)[\"']", text)
    if m:
        return m.group(1)

    # fallback: ищем settings.py
    settings_path = find_first(project_root, "settings.py")
    if not settings_path:
        return None

    rel = os.path.relpath(settings_path, project_root)
    if rel.endswith(".py"):
        rel = rel[:-3]
    return rel.replace(os.sep, ".")


def register_project(root_dir: str, zip_filename: str) -> Dict[str, Any]:
    """Сканируем только что распакованный проект и сохраняем в runner.json."""
    manage_py = find_first(root_dir, "manage.py")
    requirements = find_first(root_dir, "requirements.txt")
    env_file = find_first(root_dir, ".env")
    settings_module = detect_settings_module(manage_py, root_dir) if manage_py else None

    # имя проекта: папка с manage.py или имя архива
    if manage_py:
        project_name = os.path.basename(os.path.dirname(manage_py))
    else:
        project_name = os.path.splitext(os.path.basename(zip_filename))[0]

    project = {
        "id": os.path.basename(root_dir),
        "name": project_name,
        "root_dir": root_dir,
        "manage_py": manage_py,
        "settings_module": settings_module,
        "env_file": env_file,
        "requirements": requirements,
        "venv_path": os.path.join(DATA_BASE_DIR, "venvs", os.path.basename(root_dir)),
        "requirements_installed": False,
        "last_error": None,
    }

    state = load_state()
    state["projects"] = [p for p in state["projects"] if p.get("id") != project["id"]]
    state["projects"].append(project)
    save_state(state)

    return project


def stop_running_project(project):
    """Останавливает gunicorn по PID."""
    pid = project.get("run_pid")
    if not pid:
        return False

    try:
        os.kill(pid, signal.SIGTERM)
    except Exception as e:
        project["last_error"] = f"Ошибка остановки: {e}"
        return False

    project["run_pid"] = None
    project["is_running"] = False
    return True


def get_python_from_venv(venv_path: str) -> str:
    """Возвращает python из venv, если есть, иначе системный python."""
    if venv_path:
        cand = os.path.join(venv_path, "bin", "python")
        if os.path.exists(cand):
            return cand
        # на всякий случай виндовый вариант (в контейнере не нужен, но не мешает)
        cand_win = os.path.join(venv_path, "Scripts", "python.exe")
        if os.path.exists(cand_win):
            return cand_win
    return "python"


def get_gunicorn_path(venv_path: str) -> str:
    """Предпочитаем gunicorn из venv, иначе - системный."""
    if venv_path:
        cand = os.path.join(venv_path, "bin", "gunicorn")
        if os.path.exists(cand):
            return cand
        cand_win = os.path.join(venv_path, "Scripts", "gunicorn.exe")
        if os.path.exists(cand_win):
            return cand_win
    # fallback: глобальный gunicorn, установлен в образе
    return "gunicorn"

# ---------- HTML-шаблон ----------

INDEX_TEMPLATE = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Django Runner</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; margin: 2rem; }
      .project-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.2rem; margin-bottom: 1rem; }
      .project-title { font-weight: 600; font-size: 1.1rem; margin-bottom: 0.3rem; }
      .muted { color: #666; font-size: 0.9rem; }
      .error { color: #b00020; font-size: 0.9rem; margin-top: 0.3rem; }
      button { padding: 0.3rem 0.7rem; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>Django Runner</h1>

    <h2>Загрузить Django проект (ZIP)</h2>
    <form action="{{ url_for('upload_zip') }}" method="post" enctype="multipart/form-data">
      <input type="file" name="zip_file" accept=".zip" required>
      <button type="submit">Загрузить</button>
    </form>

    <h2 style="margin-top:2rem;">Проекты</h2>
    {% if not projects %}
      <p class="muted">Пока ни одного проекта не загружено.</p>
    {% else %}
      {% for p in projects %}
        <div class="project-card">
          <div class="project-title">{{ p.name }} <span class="muted">({{ p.id }})</span></div>
          <div class="muted">Корневая папка: {{ p.root_dir }}</div>
          <div class="muted">manage.py: {{ p.manage_py or "не найден" }}</div>
          <div class="muted">settings: {{ p.settings_module or "не определён" }}</div>
          <div class="muted">.env: {{ p.env_file or "не найден" }}</div>
          <div class="muted">requirements.txt: {{ p.requirements or "не найден" }}</div>
          <div class="muted">Зависимости: {{ "установлены" if p.requirements_installed else "не установлены" }}</div>
          {% if p.last_error %}
            <div class="error">Последняя ошибка: {{ p.last_error }}</div>
          {% endif %}
          {% if p.requirements %}
            <form action="{{ url_for('install_requirements', project_id=p.id) }}" method="post" style="margin-top:0.5rem;">
              <button type="submit">Установить зависимости</button>
            </form>
          {% endif %}
        </div>
        <form action="{{ url_for('start_project', project_id=p.id) }}" method="post" style="margin-top:0.5rem;">
          <button type="submit" {% if not p.manage_py or not p.requirements_installed %}disabled{% endif %}>Запустить</button>
        </form>

        <form action="{{ url_for('stop_project', project_id=p.id) }}" method="post" style="margin-top:0.3rem;">
          <button type="submit" {% if not p.is_running %}disabled{% endif %}>Остановить</button>
        </form>

        <div class="muted">Лог: {{ p.log_file or "ещё не создавался" }}</div>

      {% endfor %}
    {% endif %}
  </body>
</html>
"""


# ---------- Роуты ----------

@app.route("/")
def index():
    state = load_state()
    projects = state.get("projects", [])
    return render_template_string(INDEX_TEMPLATE, projects=projects)


@app.route("/upload", methods=["POST"])
def upload_zip():
    if "zip_file" not in request.files:
        return "Файл не найден в запросе (ожидается поле zip_file)", 400

    zip_file = request.files["zip_file"]

    if zip_file.filename == "":
        return "Пустое имя файла", 400

    project_id = str(uuid.uuid4())
    project_root = os.path.join(PROJECTS_DIR, project_id)
    os.makedirs(project_root, exist_ok=True)

    zip_path = os.path.join(project_root, "upload.zip")
    zip_file.save(zip_path)

    try:
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(project_root)
    except zipfile.BadZipFile:
        return "Ошибка: загруженный файл не является корректным ZIP-архивом", 400
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
        return f"Проект {project_id} не найден", 404

    req_path = project.get("requirements")
    if not req_path or not os.path.exists(req_path):
        return "requirements.txt не найден для этого проекта", 400

    venv_path = project.get("venv_path")
    os.makedirs(os.path.dirname(venv_path), exist_ok=True)

    try:
        # создаём venv, если ещё нет
        if not os.path.exists(venv_path):
            subprocess.check_call(["python", "-m", "venv", venv_path])

        python_exe = get_python_from_venv(venv_path)

        # ставим зависимости проекта
        subprocess.check_call([python_exe, "-m", "pip", "install", "-r", req_path])
        # и гарантируем gunicorn в этом же venv
        subprocess.check_call([python_exe, "-m", "pip", "install", "gunicorn"])

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
    project = next((p for p in state["projects"] if p["id"] == project_id), None)
    if not project:
        return "Проект не найден", 404

    stop_running_project(project)

    save_state(state)
    return redirect(url_for("index"))

@app.route("/projects/<project_id>/start", methods=["POST"])
def start_project(project_id):
    state = load_state()
    projects = state.get("projects", [])
    project = next((p for p in projects if p.get("id") == project_id), None)

    if not project:
        return "Проект не найден", 404

    manage_py = project.get("manage_py")
    settings_module = project.get("settings_module")
    venv_path = project.get("venv_path")
    root_dir = project.get("root_dir")

    if not manage_py or not settings_module:
        project["last_error"] = "manage.py или settings не найдены"
        save_state(state)
        return redirect(url_for("index"))

    # Останавливаем все другие проекты
    for p in projects:
        if p.get("is_running"):
            stop_running_project(p)

    # путь к wsgi.py
    wsgi_path = find_first(root_dir, "wsgi.py")
    if not wsgi_path:
        project["last_error"] = "Не найден wsgi.py"
        save_state(state)
        return redirect(url_for("index"))

    rel = os.path.relpath(wsgi_path, root_dir)
    wsgi_module = rel.replace("/", ".").replace("\\", ".").replace(".py", "")

    # Окружение
    env = os.environ.copy()
    env["DJANGO_SETTINGS_MODULE"] = settings_module

    # .env
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
            project["last_error"] = f"Ошибка чтения .env: {e}"

    # ---- collectstatic ----
    python_exe = get_python_from_venv(venv_path)
    try:
        subprocess.check_call(
            [python_exe, os.path.basename(manage_py), "collectstatic", "--noinput"],
            cwd=os.path.dirname(manage_py),
            env=env,
        )
    except subprocess.CalledProcessError as e:
        project["last_error"] = f"collectstatic завершился с ошибкой: {e}"

    # ---- запуск gunicorn через python -m gunicorn ----
    log_path = os.path.join(LOGS_DIR, f"{project_id}.log")
    log_file = open(log_path, "a", buffering=1)

    cmd = [
        python_exe,
        "-m", "gunicorn",
        "--chdir", root_dir,
        f"{wsgi_module}:application",
        "-b", "0.0.0.0:9000",
        "--workers", "3",
        "--log-file", "-",
        "--capture-output",
    ]

    try:
        process = subprocess.Popen(cmd, env=env, stdout=log_file, stderr=log_file)
        project["run_pid"] = process.pid
        project["is_running"] = True
        project["log_file"] = log_path
        # last_error оставляем — там может быть collectstatic
    except Exception as e:
        project["is_running"] = False
        project["last_error"] = f"Ошибка запуска gunicorn: {e}"

    state["projects"] = [p if p.get("id") != project_id else project for p in projects]
    save_state(state)

    return redirect(url_for("index"))

@app.route("/health")
def health():
    return "ok"

