# Kick Timer Bot - Panel de Control & Docker

Este es un bot inteligente en Python para enviar mensajes en streams de Kick.com de manera automatizada. Cuenta con una **interfaz gráfica moderna (Dashboard Web)** y soporte para ejecutarse fácilmente en un contenedor **Docker**.

## 🚀 Nuevas Funcionalidades
- **Recorrido Secuencial**: El bot recorre la lista de mensajes de forma ordenada y cíclica (de principio a fin), asegurando que no se repitan de forma aleatoria.
- **Edición en Tiempo Real**: Puedes agregar, eliminar o modificar los mensajes y cambiar los tiempos de intervalo desde la interfaz web, aplicándose **de inmediato** sin desconectar ni reiniciar el bot.
- **Ejecución en Docker**: Todo el sistema empaquetado para que no tengas que instalar dependencias de Python localmente.

---

## 🛠️ Cómo arrancar con Docker (Recomendado)

Si no tienes experiencia en programación o Docker, sigue estos sencillos pasos:

### Paso 1: Instalar Docker Desktop
1. Descarga e instala **Docker Desktop para Windows** desde su sitio oficial:  
   [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Abre Docker Desktop y asegúrate de que esté ejecutándose (el icono de la ballena debe verse en verde en tu barra de tareas).

### Paso 2: Iniciar el Bot
1. Abre una terminal (como PowerShell) en la carpeta del proyecto:
   - Mantén presionado `Shift` y haz clic derecho en el fondo de la carpeta `Grok`.
   - Selecciona **"Abrir la ventana de PowerShell aquí"** (o "Abrir en Terminal").
2. Ejecuta el siguiente comando para construir y encender la aplicación:
   ```powershell
   docker compose up --build -d
   ```
3. ¡Listo! Abre tu navegador web e ingresa a:  
   👉 **[http://localhost:5000](http://localhost:5000)**

*(Para detener el bot en el futuro, ejecuta `docker compose down` en la misma terminal)*.

---

## 💻 Panel de Control Web (Dashboard)

Al ingresar a `http://localhost:5000`, verás una interfaz gráfica moderna donde podrás:
1. **Configurar la App de Kick**:
   - Introduce tu **Client ID** y **Client Secret** (los obtienes creando una app en [https://kick.com/developer](https://kick.com/developer)).
   - Ajusta la **Redirect URI** a `http://localhost:5000/callback`.
2. **Vincular tu cuenta**:
   - Haz clic en **"Vincular Cuenta"** para autenticar de forma segura la cuenta de Kick que enviará los mensajes.
3. **Controlar el Bot**:
   - Botón **Iniciar Bot** para empezar a enviar mensajes.
   - Botón **Detener Bot** para pausarlo.
4. **Editar en Tiempo Real**:
   - Escribe el **Canal Objetivo** (el slug del streamer, ej: `xqc`).
   - Modifica el **Intervalo** (minutos) y la **Variación Jitter** (segundos).
   - Edita la lista de **Mensajes** (uno por línea).
   - Haz clic en **"Guardar y Aplicar"** y los cambios de tiempos y mensajes se adaptarán inmediatamente sin interrumpir el bot.
5. **Ver Logs en Tiempo Real**:
   - Una consola integrada te mostrará qué mensajes se están enviando, el contador y los tiempos de espera exactos.

---

## 🐍 Ejecución Local (Sin Docker)

Si prefieres ejecutar el bot directamente con Python en tu sistema:

1. **Instalar dependencias**:
   ```bash
   pip install -r requirements.txt
   ```
2. **Lanzar la interfaz web**:
   ```bash
   python -m uvicorn app.main:app --host 0.0.0.0 --port 5000
   ```
   E ingresa a `http://localhost:5000`.

### Ejecutar sólo por consola (CLI)
Si prefieres no usar la interfaz web, puedes editar las variables dentro de los scripts y ejecutar en terminal:
- `python kick_timer_bot.py` (Versión recomendada con OAuth)
- `python kick_timer_bot_simple.py` (Versión básica con token manual)

---

## ⚠️ Advertencias y Buenas Prácticas
- **Usa una cuenta secundaria**: No uses tu cuenta principal para evitar riesgos de baneo si se abusa del spam.
- **Variedad**: Pon al menos 20-30 mensajes diferentes. Cuantos más tengas, más humano parecerá.
- **Respeta las reglas del chat**: Modifica los intervalos para cumplir con el slow-mode del canal.
