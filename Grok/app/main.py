import asyncio
import json
import logging
import os
import random
import secrets
import hashlib
import base64
import contextvars
from urllib.parse import urlencode
from datetime import datetime
from typing import Optional, Dict

from fastapi import FastAPI, Request, HTTPException, Response, Cookie, Depends, status
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from kickpy import KickClient
import kickpy.client

# ----------------- CONFIGURACIÓN DE ContextVars Y MONKEYPATCH -----------------
# ContextVar para rastrear el usuario activo en las tareas asíncronas
current_username_context = contextvars.ContextVar("current_username")

# Guardar la función open original de Python
_original_open = open

# Interceptar llamadas a abrir el archivo de token de kickcom.py y redirigirlo a la carpeta del usuario
def custom_open(file, *args, **kwargs):
    if isinstance(file, str) and file == ".kick.user_token.json":
        username = current_username_context.get(None)
        if username:
            user_dir = os.path.join(CONFIG_DIR, "users", username)
            os.makedirs(user_dir, exist_ok=True)
            return _original_open(os.path.join(user_dir, ".kick.user_token.json"), *args, **kwargs)
    return _original_open(file, *args, **kwargs)

# Aplicar el parche en el módulo de kickpy
kickpy.client.open = custom_open

# ----------------- CONFIGURACIÓN DE DIRECTORIOS -----------------
APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")

# Ruta de datos persistentes (se usará un volumen Docker o carpeta local)
CONFIG_DIR = os.path.abspath(os.getenv("CONFIG_DIR", "./data"))
os.makedirs(CONFIG_DIR, exist_ok=True)

# Cambiamos el directorio de trabajo al directorio de configuración
os.chdir(CONFIG_DIR)

USERS_DB_PATH = os.path.join(CONFIG_DIR, "users.json")

# ----------------- LOGS SEPARADOS POR USUARIO -----------------
user_log_queues: Dict[str, list] = {}
user_log_counters: Dict[str, int] = {}
max_logs = 200

class QueueHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            username = current_username_context.get(None)
            
            # Formateamos el mensaje con el usuario si existe
            formatted_msg = f"[{username}] {msg}" if username else f"[SYSTEM] {msg}"
            
            # Imprimir en consola de Docker/Terminal
            print(formatted_msg, flush=True)
            
            # Todo mensaje (sea de usuario o sistema) va también a la cola del admin
            if "admin" not in user_log_queues:
                user_log_queues["admin"] = []
                user_log_counters["admin"] = 0
            
            log_id_admin = user_log_counters["admin"] + 1
            user_log_counters["admin"] = log_id_admin
            user_log_queues["admin"].append((log_id_admin, formatted_msg))
            if len(user_log_queues["admin"]) > max_logs:
                user_log_queues["admin"].pop(0)
                
            # Y si hay un usuario específico, lo guardamos en su propia cola
            if username and username != "admin":
                if username not in user_log_queues:
                    user_log_queues[username] = []
                    user_log_counters[username] = 0
                
                log_id_user = user_log_counters[username] + 1
                user_log_counters[username] = log_id_user
                user_log_queues[username].append((log_id_user, msg))
                if len(user_log_queues[username]) > max_logs:
                    user_log_queues[username].pop(0)
        except Exception:
            self.handleError(record)

# Configurar el logger
logger = logging.getLogger("kick_bot")
logger.setLevel(logging.INFO)
handler = QueueHandler()
formatter = logging.Formatter("[%(asctime)s] %(message)s", datefmt="%H:%M:%S")
handler.setFormatter(formatter)
logger.addHandler(handler)

# ----------------- GESTIÓN DE USUARIOS Y CRIPTO -----------------
def hash_password(password: str, salt: str = None) -> tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((password + salt).encode('utf-8')).hexdigest()
    return hashed, salt

def verify_password(password: str, hashed: str, salt: str) -> bool:
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest() == hashed

def load_users() -> dict:
    if os.path.exists(USERS_DB_PATH):
        try:
            with open(USERS_DB_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error cargando users.json: {e}")
            
    # Si no existe, crear admin por defecto: admin / admin
    salt = secrets.token_hex(16)
    hashed, _ = hash_password("admin", salt)
    default_users = {
        "admin": {
            "username": "admin",
            "password_hash": hashed,
            "salt": salt,
            "is_admin": True
        }
    }
    save_users(default_users)
    logger.info("=== [SYSTEM] Creado usuario administrador por defecto: admin / admin ===")
    return default_users

def save_users(users: dict):
    try:
        with open(USERS_DB_PATH, "w", encoding="utf-8") as f:
            json.dump(users, f, indent=4, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error guardando users.json: {e}")

# ----------------- GESTIÓN DE SESIONES ACTIVAS -----------------
# Estructura: { username: { "session_id": str, "ip": str } }
active_sessions: Dict[str, dict] = {}
session_to_user: Dict[str, str] = {}

# ----------------- GESTIÓN DE CONFIGURACIÓN POR USUARIO -----------------
DEFAULT_MESSAGES = [
    "Jajajaja buena esa",
    "Qué crack",
    "Vamos equipo 🔥",
    "Esto está muy bueno",
    "Jajaja no puede ser",
    "Buen juego",
    "Me estoy riendo mucho con esto",
    "Pog",
    "Qué buena jugada",
    "Jaajajaj",
    "Esto es épico",
    "Buenísimo",
    "Estoy flipando",
    "xd",
    "Lmao",
    "No way",
    "Qué buena reacción",
    "Me encanta este stream",
    "Sigue así",
    "Jajajaja",
    "Buena",
    "Esto se pone bueno",
    "Real",
    "100%",
    "Facts"
]

def load_user_config(username: str) -> dict:
    user_dir = os.path.join(CONFIG_DIR, "users", username)
    os.makedirs(user_dir, exist_ok=True)
    config_path = os.path.join(user_dir, "config.json")
    
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error cargando config para {username}: {e}")
            
    default_config = {
        "client_id": "",
        "client_secret": "",
        "channel_slug": "kashee_teamcosta",
        "interval_minutes": 5,
        "jitter_seconds": 45,
        "redirect_uri": "http://localhost:5000/callback",
        "messages": DEFAULT_MESSAGES,
        "random_mode": False,
        "templates": {},
        "schedule_start": "",
        "schedule_stop": ""
    }
    save_user_config(username, default_config)
    return default_config

def save_user_config(username: str, config: dict):
    user_dir = os.path.join(CONFIG_DIR, "users", username)
    os.makedirs(user_dir, exist_ok=True)
    config_path = os.path.join(user_dir, "config.json")
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error guardando config para {username}: {e}")

# ----------------- MANAGER DEL BOT DE KICK -----------------
class BotManager:
    def __init__(self):
        self.task: Optional[asyncio.Task] = None
        self.status = "stopped"  # "stopped", "running", "error"
        self.messages_sent = 0
        self.last_messages = []
        self.error_message = ""
        self.current_channel = ""

    async def run_bot_loop(self, username: str, config: dict):
        self.status = "running"
        self.error_message = ""
        self.current_channel = config["channel_slug"]
        
        # Activar la ContextVar para la tarea asíncrona actual
        current_username_context.set(username)
        
        logger.info("=== Iniciando bucle de comentarios ===")
        logger.info(f"Canal objetivo: {config['channel_slug']}")
        logger.info(f"Intervalo: {config['interval_minutes']} min (+/- {config['jitter_seconds']}s)")

        # Validar si el token de usuario existe en su directorio
        token_path = os.path.join(CONFIG_DIR, "users", username, ".kick.user_token.json")
        if not os.path.exists(token_path):
            logger.error("Error: No se encontró el token de usuario. Vincula tu cuenta primero.")
            self.status = "error"
            self.error_message = "El bot no está autenticado. Vincula tu cuenta de Kick en la interfaz."
            return

        client = KickClient(config["client_id"], config["client_secret"])
        
        try:
            logger.info("Obteniendo ID del canal de Kick...")
            channel = await client.fetch_channel(slug=config["channel_slug"])
            broadcaster_id = channel.broadcaster_user_id
            logger.info(f"ID del streamer obtenido: {broadcaster_id}")

            message_index = 0
            while True:
                # Asegurar ContextVar activa en cada ciclo
                current_username_context.set(username)
                
                # Cargar configuración fresca
                current_config = load_user_config(username)
                messages = current_config.get("messages", [])
                random_mode = current_config.get("random_mode", False)
                
                if not messages:
                    logger.error("No hay mensajes configurados en la lista.")
                    await asyncio.sleep(10)
                    continue

                if random_mode:
                    mensaje = random.choice(messages)
                    logger.info(f"Enviando mensaje (Aleatorio): '{mensaje}'")
                else:
                    if message_index >= len(messages):
                        message_index = 0
                    mensaje = messages[message_index]
                    logger.info(f"Enviando mensaje ({message_index + 1}/{len(messages)}): '{mensaje}'")
                    message_index = (message_index + 1) % len(messages)
                
                await client.send_chat_message(
                    content=mensaje,
                    message_type="user",
                    broadcaster_user_id=broadcaster_id,
                )
                
                self.messages_sent += 1
                self.last_messages.append(mensaje)
                if len(self.last_messages) > 3:
                    self.last_messages.pop(0)
                
                interval_minutes = current_config.get("interval_minutes", 5)
                jitter_seconds = current_config.get("jitter_seconds", 45)
                
                base = interval_minutes * 60
                jitter = random.randint(-jitter_seconds, jitter_seconds)
                sleep_time = max(5, base + jitter)
                
                next_run = datetime.now().timestamp() + sleep_time
                next_run_str = datetime.fromtimestamp(next_run).strftime("%H:%M:%S")
                logger.info(f"Mensaje enviado con éxito. Próximo en {sleep_time // 60}m {sleep_time % 60}s (alrededor de {next_run_str})")
                
                await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            self.status = "stopped"
        except Exception as e:
            logger.error(f"Error fatal en el bot: {e}")
            self.status = "error"
            self.error_message = str(e)
        finally:
            await client.close()
            if self.status == "running":
                self.status = "stopped"
            current_username_context.set(username)
            logger.info(f"Bot detenido. Mensajes enviados en total: {self.messages_sent}")

    def start(self, username: str, config: dict):
        if self.task and not self.task.done():
            return
        # Establecemos el contexto y creamos la tarea
        current_username_context.set(username)
        self.task = asyncio.create_task(self.run_bot_loop(username, config))

    def stop(self):
        if self.task and not self.task.done():
            self.task.cancel()

# Diccionario de bot managers por usuario
bot_managers: Dict[str, BotManager] = {}

def get_bot_manager(username: str) -> BotManager:
    if username not in bot_managers:
        bot_managers[username] = BotManager()
    return bot_managers[username]

# ----------------- SEGURIDAD Y OAUTH PKCE -----------------
oauth_sessions = {}  # { state: { "code_verifier": str, "username": str } }

def generate_pkce_pair():
    verifier = secrets.token_urlsafe(64)
    sha256_hash = hashlib.sha256(verifier.encode('utf-8')).digest()
    challenge = base64.urlsafe_b64encode(sha256_hash).decode('utf-8').rstrip('=')
    return verifier, challenge

# ----------------- DEPENDENCIAS DE AUTENTICACIÓN -----------------
def get_current_user(session_token: Optional[str] = Cookie(None)) -> str:
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado"
        )
    username = session_to_user.get(session_token)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión no válida o iniciada en otro dispositivo"
        )
    
    # Control de Sesión Única (IP/Dispositivo)
    if username in active_sessions and active_sessions[username]["session_id"] != session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión cerrada. Has iniciado sesión en otro dispositivo."
        )
        
    # Guardar en ContextVar para este hilo de ejecución de la petición
    current_username_context.set(username)
    return username

def get_current_admin(username: str = Depends(get_current_user)) -> str:
    users = load_users()
    user = users.get(username)
    if not user or not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permiso denegado. Se requiere cuenta de Administrador."
        )
    return username

# ----------------- SERVIDOR WEB FASTAPI -----------------
app = FastAPI(title="Kick Bot Dashboard")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    session_token = request.cookies.get("session_token")
    if not session_token or session_token not in session_to_user:
        return RedirectResponse(url="/static/login.html")
        
    username = session_to_user[session_token]
    if username in active_sessions and active_sessions[username]["session_id"] != session_token:
        return RedirectResponse(url="/static/login.html")
    
    users = load_users()
    user = users.get(username)
    if user and user.get("is_admin"):
        admin_path = os.path.join(STATIC_DIR, "admin.html")
        if os.path.exists(admin_path):
            with open(admin_path, "r", encoding="utf-8") as f:
                return f.read()
        
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Error: app/static/index.html no encontrado.</h1>"

# API de Autenticación
@app.post("/api/auth/login")
async def api_login(data: dict, response: Response, request: Request):
    username = data.get("username", "").strip().lower()
    password = data.get("password", "")
    
    if not username or not password:
        logger.warning(f"Intento de inicio de sesión incompleto desde la IP {request.client.host}")
        raise HTTPException(status_code=400, detail="Por favor, rellena todos los campos.")
        
    users = load_users()
    user = users.get(username)
    
    if not user or not verify_password(password, user["password_hash"], user["salt"]):
        logger.warning(f"Intento de inicio de sesión fallido para '{username}' desde la IP {request.client.host}")
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")
        
    # Establecer contextvar antes de loguear inicio de sesión exitoso
    current_username_context.set(username)
    logger.info(f"Inicio de sesión correcto desde la IP {request.client.host}")
    
    # Invalidar sesión anterior si existía (Control de dispositivo único)
    if username in active_sessions:
        old_session = active_sessions[username]["session_id"]
        if old_session in session_to_user:
            del session_to_user[old_session]
            logger.info(f"Sesión anterior para '{username}' invalidada por nuevo inicio de sesión.")
            
    # Crear nueva sesión
    session_id = secrets.token_hex(32)
    active_sessions[username] = {
        "session_id": session_id,
        "ip": request.client.host,
        "login_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    session_to_user[session_id] = username
    
    response.set_cookie(
        key="session_token",
        value=session_id,
        httponly=True,
        max_age=86400,  # 1 día
        samesite="lax"
    )
    
    return {"status": "ok", "message": "Inicio de sesión correcto", "username": username, "is_admin": user.get("is_admin", False)}

@app.post("/api/auth/logout")
async def api_logout(response: Response, username: str = Depends(get_current_user), session_token: str = Cookie(None)):
    current_username_context.set(username)
    logger.info("Cerró sesión voluntariamente.")
    if session_token in session_to_user:
        del session_to_user[session_token]
    if username in active_sessions and active_sessions[username]["session_id"] == session_token:
        del active_sessions[username]
        
    response.delete_cookie("session_token")
    return {"status": "ok", "message": "Sesión cerrada correctamente"}

@app.get("/api/auth/check")
async def api_auth_check(username: str = Depends(get_current_user)):
    users = load_users()
    user = users.get(username)
    return {
        "authenticated": True,
        "username": username,
        "is_admin": user.get("is_admin", False) if user else False
    }

# API de Configuración
@app.get("/api/config")
async def api_get_config(username: str = Depends(get_current_user)):
    return load_user_config(username)

@app.post("/api/config")
async def api_save_config(config: dict, username: str = Depends(get_current_user)):
    current_username_context.set(username)
    current_config = load_user_config(username)
    
    # Sanitizar valores de tiempo para evitar corrupción (None/NaN)
    if "interval_minutes" in config:
        try:
            val = int(config["interval_minutes"])
            if val < 1:
                val = 1
            config["interval_minutes"] = val
        except (ValueError, TypeError):
            config["interval_minutes"] = current_config.get("interval_minutes", 5)
            
    if "jitter_seconds" in config:
        try:
            val = int(config["jitter_seconds"])
            if val < 0:
                val = 0
            config["jitter_seconds"] = val
        except (ValueError, TypeError):
            config["jitter_seconds"] = current_config.get("jitter_seconds", 45)
            
    critical_change = (
        current_config.get("client_id") != config.get("client_id") or
        current_config.get("client_secret") != config.get("client_secret") or
        current_config.get("channel_slug") != config.get("channel_slug")
    )
    
    current_config.update(config)
    save_user_config(username, current_config)
    
    mgr = get_bot_manager(username)
    if mgr.status == "running" and critical_change:
        logger.info(f"[{username}] Configuración crítica actualizada. Reiniciando bot...")
        mgr.stop()
        await asyncio.sleep(1)
        mgr.start(username, current_config)
    elif mgr.status == "running":
        logger.info(f"[{username}] Mensajes/Tiempos actualizados en tiempo real.")
        
    return {"status": "ok", "message": "Configuración guardada"}

@app.get("/api/status")
async def api_get_status(username: str = Depends(get_current_user)):
    token_path = os.path.join(CONFIG_DIR, "users", username, ".kick.user_token.json")
    token_exists = os.path.exists(token_path)
    mgr = get_bot_manager(username)
    config = load_user_config(username)
    return {
        "status": mgr.status,
        "messages_sent": mgr.messages_sent,
        "last_messages": mgr.last_messages,
        "error_message": mgr.error_message,
        "current_channel": mgr.current_channel or config.get("channel_slug", "-"),
        "authenticated": token_exists,
        "schedule_start": config.get("schedule_start", ""),
        "schedule_stop": config.get("schedule_stop", "")
    }

@app.post("/api/bot/start")
async def api_start_bot(username: str = Depends(get_current_user)):
    current_username_context.set(username)
    config = load_user_config(username)
    
    if not config.get("client_id") or not config.get("client_secret"):
        raise HTTPException(status_code=400, detail="Configura el Client ID y Client Secret antes de iniciar.")
        
    token_path = os.path.join(CONFIG_DIR, "users", username, ".kick.user_token.json")
    if not os.path.exists(token_path):
        raise HTTPException(status_code=400, detail="Debes vincular tu cuenta de Kick antes de iniciar el bot.")
        
    mgr = get_bot_manager(username)
    mgr.start(username, config)
    return {"status": "ok", "message": "Bot iniciado"}

@app.post("/api/bot/stop")
async def api_stop_bot(username: str = Depends(get_current_user)):
    mgr = get_bot_manager(username)
    mgr.stop()
    return {"status": "ok", "message": "Bot detenido"}

@app.get("/api/logs")
async def api_logs_stream(username: str = Depends(get_current_user), last_id: int = 0):
    # SSE de logs filtrados para el usuario o para el admin
    async def log_generator():
        # Si el usuario es admin, le transmitimos la cola "admin" que contiene todo
        users = load_users()
        user_info = users.get(username)
        is_admin = user_info.get("is_admin", False) if user_info else False
        
        target_queue_name = "admin" if is_admin else username
        
        if target_queue_name not in user_log_queues:
            user_log_queues[target_queue_name] = []
            user_log_counters[target_queue_name] = 0
            
        current_queue = list(user_log_queues[target_queue_name])
        
        last_sent_id = last_id
        if last_sent_id == 0:
            for log_id, log_line in current_queue:
                yield f"data: {json.dumps({'id': log_id, 'text': log_line}, ensure_ascii=False)}\n\n"
                last_sent_id = max(last_sent_id, log_id)
        
        while True:
            await asyncio.sleep(0.5)
            current_username_context.set(username)
            
            queue = list(user_log_queues.get(target_queue_name, []))
            for log_id, log_line in queue:
                if log_id > last_sent_id:
                    yield f"data: {json.dumps({'id': log_id, 'text': log_line}, ensure_ascii=False)}\n\n"
                    last_sent_id = log_id

    return StreamingResponse(log_generator(), media_type="text/event-stream")

# ----------------- ADMINISTRACIÓN DE USUARIOS (Solo Admin) -----------------
@app.get("/api/admin/bots")
async def api_admin_list_bots(username: str = Depends(get_current_admin)):
    users = load_users()
    bots_status = []
    # Usamos el key del dict (no el campo interno 'username') para evitar inconsistencias
    for user_key, u in users.items():
        target_user = user_key
        mgr = get_bot_manager(target_user)
        config = load_user_config(target_user)
        token_path = os.path.join(CONFIG_DIR, "users", target_user, ".kick.user_token.json")
        token_exists = os.path.exists(token_path)
        session_info = active_sessions.get(target_user, {})
        
        bots_status.append({
            "username": target_user,
            "status": mgr.status,
            "messages_sent": mgr.messages_sent,
            "last_messages": mgr.last_messages,
            "error_message": mgr.error_message,
            "current_channel": mgr.current_channel or config.get("channel_slug", "-"),
            "authenticated": token_exists,
            "ip_activa": session_info.get("ip", "Desconectado"),
            "login_time": session_info.get("login_time", "-"),
            "schedule_start": config.get("schedule_start", ""),
            "schedule_stop": config.get("schedule_stop", ""),
            "client_id": config.get("client_id", ""),
            "client_secret": config.get("client_secret", ""),
            "channel_slug": config.get("channel_slug", "")
        })
    return bots_status

# ----------------- CONTROL DE BOTS POR EL ADMIN -----------------
@app.post("/api/admin/bot/start/{target_user}")
async def api_admin_start_bot(target_user: str, username: str = Depends(get_current_admin)):
    target_user = target_user.strip().lower()
    config = load_user_config(target_user)
    if not config.get("client_id") or not config.get("client_secret"):
        raise HTTPException(status_code=400, detail=f"El usuario {target_user} no tiene configurado Client ID/Secret.")
    token_path = os.path.join(CONFIG_DIR, "users", target_user, ".kick.user_token.json")
    if not os.path.exists(token_path):
        raise HTTPException(status_code=400, detail=f"El usuario {target_user} no ha vinculado su cuenta de Kick.")
    mgr = get_bot_manager(target_user)
    mgr.start(target_user, config)
    logger.info(f"[ADMIN] Bot de '{target_user}' iniciado manualmente por el Administrador.")
    return {"status": "ok", "message": f"Bot de {target_user} iniciado"}

@app.post("/api/admin/bot/stop/{target_user}")
async def api_admin_stop_bot(target_user: str, username: str = Depends(get_current_admin)):
    target_user = target_user.strip().lower()
    mgr = get_bot_manager(target_user)
    mgr.stop()
    logger.info(f"[ADMIN] Bot de '{target_user}' detenido manualmente por el Administrador.")
    return {"status": "ok", "message": f"Bot de {target_user} detenido"}

@app.post("/api/admin/bot/reset_counter/{target_user}")
async def api_admin_reset_counter(target_user: str, username: str = Depends(get_current_admin)):
    target_user = target_user.strip().lower()
    mgr = get_bot_manager(target_user)
    mgr.messages_sent = 0
    logger.info(f"[ADMIN] Contador de mensajes del bot de '{target_user}' reiniciado por el Administrador.")
    return {"status": "ok", "message": f"Contador de {target_user} reiniciado"}

@app.post("/api/admin/bot/schedule/{target_user}")
async def api_admin_save_schedule(target_user: str, data: dict, username: str = Depends(get_current_admin)):
    target_user = target_user.strip().lower()
    config = load_user_config(target_user)
    
    if "schedule_start" in data:
        config["schedule_start"] = data.get("schedule_start", "").strip()
    if "schedule_stop" in data:
        config["schedule_stop"] = data.get("schedule_stop", "").strip()
    if "client_id" in data:
        config["client_id"] = data.get("client_id", "").strip()
    if "client_secret" in data:
        config["client_secret"] = data.get("client_secret", "").strip()
    if "channel_slug" in data:
        config["channel_slug"] = data.get("channel_slug", "").strip()
        
    save_user_config(target_user, config)
    logger.info(f"[ADMIN] Configuración de '{target_user}' modificada por Administrador.")
    return {"status": "ok", "message": "Configuración guardada correctamente"}

@app.get("/api/admin/users")
async def api_admin_list_users(username: str = Depends(get_current_admin)):
    users = load_users()
    response_users = []
    for user_key, u in users.items():
        session_info = active_sessions.get(user_key, {})
        response_users.append({
            "username": user_key,
            "is_admin": u.get("is_admin", False),
            "ip_activa": session_info.get("ip", "Desconectado"),
            "login_time": session_info.get("login_time", "-")
        })
    return response_users

@app.post("/api/admin/users")
async def api_admin_create_user(data: dict, username: str = Depends(get_current_admin)):
    target_username = data.get("username", "").strip().lower()
    password = data.get("password", "")
    is_admin = bool(data.get("is_admin", False))
    
    if not target_username or not password:
        raise HTTPException(status_code=400, detail="El nombre de usuario y contraseña son obligatorios.")
        
    if not target_username.isalnum() or len(target_username) < 3:
        raise HTTPException(status_code=400, detail="El nombre de usuario debe ser alfanumérico y tener al menos 3 caracteres.")
        
    users = load_users()
    if target_username in users:
        raise HTTPException(status_code=400, detail="El nombre de usuario ya está registrado.")
        
    salt = secrets.token_hex(16)
    hashed, _ = hash_password(password, salt)
    
    users[target_username] = {
        "username": target_username,
        "password_hash": hashed,
        "salt": salt,
        "is_admin": is_admin
    }
    save_users(users)
    logger.info(f"[ADMIN] Usuario creado: {target_username} (is_admin: {is_admin})")
    return {"status": "ok", "message": f"Usuario {target_username} creado correctamente."}

@app.delete("/api/admin/users/{target_username}")
async def api_admin_delete_user(target_username: str, username: str = Depends(get_current_admin)):
    target_username = target_username.strip().lower()
    if target_username == username:
        raise HTTPException(status_code=400, detail="No puedes borrarte a ti mismo.")
        
    if target_username == "admin":
        raise HTTPException(status_code=400, detail="No se puede borrar el administrador principal del sistema.")
        
    users = load_users()
    if target_username not in users:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        
    # Detener bot activo del usuario si está corriendo
    mgr = get_bot_manager(target_username)
    mgr.stop()
    
    # Eliminar sesiones activas
    if target_username in active_sessions:
        token = active_sessions[target_username]["session_id"]
        if token in session_to_user:
            del session_to_user[token]
        del active_sessions[target_username]
        
    del users[target_username]
    save_users(users)
    
    # Eliminar también su carpeta de configuración y tokens
    import shutil
    user_dir = os.path.join(CONFIG_DIR, "users", target_username)
    if os.path.exists(user_dir):
        try:
            shutil.rmtree(user_dir)
        except Exception as e:
            logger.error(f"Error eliminando directorio de {target_username}: {e}")
            
    logger.info(f"[ADMIN] Usuario eliminado: {target_username}")
    return {"status": "ok", "message": f"Usuario {target_username} eliminado correctamente."}

# ----------------- FLUJO DE AUTENTICACIÓN OAUTH -----------------
@app.get("/api/auth/login_oauth")
async def auth_login_oauth(target_user: Optional[str] = None, username: str = Depends(get_current_user)):
    users = load_users()
    user_info = users.get(username)
    is_admin = user_info.get("is_admin", False) if user_info else False
    
    active_user = username
    if is_admin and target_user:
        active_user = target_user.strip().lower()
        
    config = load_user_config(active_user)
    if not config.get("client_id") or not config.get("client_secret"):
        raise HTTPException(status_code=400, detail=f"Por favor, configura primero el Client ID y Client Secret para '{active_user}'.")
    
    code_verifier, code_challenge = generate_pkce_pair()
    state = secrets.token_urlsafe(16)
    
    oauth_sessions[state] = {
        "code_verifier": code_verifier,
        "username": active_user
    }
    
    scopes = "chat:write channel:read"
    params = {
        "client_id": config["client_id"],
        "response_type": "code",
        "redirect_uri": config["redirect_uri"],
        "state": state,
        "scope": scopes,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256"
    }
    
    authorize_url = f"https://id.kick.com/oauth/authorize?{urlencode(params)}"
    logger.info(f"[{username}] Redirigiendo al usuario a Kick para autorización...")
    return RedirectResponse(authorize_url)

@app.get("/callback")
async def auth_callback(code: str = None, state: str = None, error: str = None):
    if error:
        logger.error(f"Error en autorización OAuth: {error}")
        return RedirectResponse(url="/?auth=error&error=" + error)
        
    if not code or not state:
        raise HTTPException(status_code=400, detail="Código o estado ausentes.")
        
    session_data = oauth_sessions.get(state)
    if not session_data:
        logger.error("State de OAuth inválido o sesión expirada.")
        return RedirectResponse(url="/?auth=invalid_state")
        
    code_verifier = session_data["code_verifier"]
    username = session_data["username"]
    
    # Limpiar sesión temporal
    del oauth_sessions[state]
    
    config = load_user_config(username)
    
    try:
        logger.info(f"[{username}] Intercambiando código de autorización por Token de acceso...")
        client = KickClient(config["client_id"], config["client_secret"])
        
        # Establecer ContextVar para que custom_open guarde en el directorio correcto
        token = current_username_context.set(username)
        
        await client._exchange_code(
            code=code,
            redirect_uri=config["redirect_uri"],
            code_verifier=code_verifier
        )
        
        logger.info(f"✅ [{username}] ¡Autenticación exitosa! Token guardado correctamente.")
        await client.close()
        return RedirectResponse(url="/?auth=success")
        
    except Exception as e:
        logger.error(f"Error durante el intercambio de token para {username}: {e}")
        return RedirectResponse(url=f"/?auth=failed&error={e}")

# Ejecutar carga inicial de usuarios
load_users()

# ----------------- PROCESO DE PLANIFICADOR DE BOTS -----------------
async def schedule_checker_loop():
    while True:
        try:
            # Ejecutar comprobaciones cada 60 segundos
            await asyncio.sleep(60)
            now_str = datetime.now().strftime("%H:%M")
            users = load_users()
            for username in users.keys():
                config = load_user_config(username)
                sch_start = config.get("schedule_start", "").strip()
                sch_stop = config.get("schedule_stop", "").strip()
                mgr = get_bot_manager(username)
                
                if sch_start == now_str and mgr.status != "running":
                    current_username_context.set(username)
                    logger.info(f"[SCHEDULER] Iniciando bot programado automáticamente para las {sch_start}")
                    if config.get("client_id") and config.get("client_secret"):
                        token_path = os.path.join(CONFIG_DIR, "users", username, ".kick.user_token.json")
                        if os.path.exists(token_path):
                            mgr.start(username, config)
                        else:
                            logger.error("[SCHEDULER] Error al iniciar bot automáticamente: Vincule la cuenta de Kick primero.")
                    else:
                        logger.error("[SCHEDULER] Error al iniciar bot automáticamente: Faltan credenciales Client ID/Secret.")
                        
                if sch_stop == now_str and mgr.status == "running":
                    current_username_context.set(username)
                    logger.info(f"[SCHEDULER] Deteniendo bot programado automáticamente para las {sch_stop}")
                    mgr.stop()
        except Exception as ex:
            print(f"[SCHEDULER ERROR] {ex}", flush=True)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(schedule_checker_loop())
