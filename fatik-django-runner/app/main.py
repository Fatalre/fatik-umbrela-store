from flask import Flask, request, jsonify, render_template_string
import os
import zipfile
import uuid

app = Flask(__name__)

DATA_DIR = "/data/projects"

# HTML форма прямо в коде (потом можно вынести в шаблон)
UPLOAD_FORM = """
<h2>Загрузить Django проект (ZIP)</h2>
<form action="/upload" method="post" enctype="multipart/form-data">
    <input type="file" name="zip_file" accept=".zip" required>
    <br><br>
    <button type="submit">Загрузить</button>
</form>
"""

@app.route("/")
def index():
    return UPLOAD_FORM

@app.route("/upload", methods=["POST"])
def upload_zip():
    if "zip_file" not in request.files:
        return "Файл не найден", 400

    zip_file = request.files["zip_file"]

    if zip_file.filename == "":
        return "Пустое имя файла", 400

    # уникальное имя проекта
    project_id = str(uuid.uuid4())
    project_path = os.path.join(DATA_DIR, project_id)

    os.makedirs(project_path, exist_ok=True)

    # путь к временному архиву
    zip_path = os.path.join(project_path, "upload.zip")
    zip_file.save(zip_path)

    # распаковываем
    try:
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(project_path)
    except zipfile.BadZipFile:
        return "Ошибка: загруженный файл не ZIP", 400

    # удаляем архив
    os.remove(zip_path)

    return f"Проект успешно загружен! ID: {project_id}"

