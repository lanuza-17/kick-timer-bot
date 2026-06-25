# Usar una imagen oficial de Python ligera
FROM python:3.11-slim

# Establecer variables de entorno
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV CONFIG_DIR=/data

# Crear directorio de la aplicación
WORKDIR /app

# Instalar dependencias del sistema necesarias
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements e instalar dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código fuente de la app
COPY app/ ./app/

# Crear la carpeta de datos persistentes (volumen)
RUN mkdir -p /data

# Exponer el puerto del servidor web
EXPOSE 5000

# Ejecutar el servidor web con Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
