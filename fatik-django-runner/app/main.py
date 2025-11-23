from flask import Flask

app = Flask(__name__)


@app.route("/")
def index():
    return """
    <html>
      <head><title>Django Runner</title></head>
      <body style="font-family: sans-serif;">
        <h1>Django Runner</h1>
        <p>Приложение установлено и работает.</p>
        <p>Дальше сюда добавим загрузку ZIP и управление проектами Django.</p>
      </body>
    </html>
    """


@app.route("/health")
def health():
    return "ok"
