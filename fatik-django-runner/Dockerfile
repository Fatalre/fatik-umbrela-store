FROM python:3.12-slim

# Обновляем систему и ставим нужные утилиты
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Ставим зависимости для панели (потом сюда добавим ещё, если потребуется)
RUN pip install --no-cache-dir flask gunicorn

# Создаём директории
RUN mkdir -p /app /data/projects /data/venvs

# Кладём наш код
WORKDIR /app
COPY app/ /app/

# Порт внутри контейнера
EXPOSE 8000

# Запускаем Flask через gunicorn
CMD ["gunicorn", "main:app", "-b", "0.0.0.0:8000", "--workers", "2"]
