#!/usr/bin/env python3
"""
Versión SIMPLE del Kick Timer Bot (sin librerías pesadas)

Usa requests + Bearer Token directamente (más fácil si ya tienes un token).

Cómo obtener un Access Token rápidamente:
1. Crea una App en https://kick.com/developer
2. Usa el flujo de OAuth manualmente o usa una herramienta como:
   - Postman
   - Un pequeño script de OAuth (puedo darte uno)
   - O inspecciona la red después de autorizar en el navegador y copia el token de Authorization header.

Alternativa fácil (temporal):
   Muchos usan el token de usuario que aparece después de loguearte en el sitio web
   (en DevTools > Network > cualquier request a api.kick.com → Authorization: Bearer ...)

⚠️ Usa cuenta secundaria. Riesgo de ban.

Instalación:
    pip install requests python-dotenv

Config:
    Edita las variables abajo o usa un archivo .env
"""

import requests
import time
import random
import os
from datetime import datetime

# ====================== CONFIG ======================
# Pon tu token de usuario aquí (Bearer token con scope chat:write)
ACCESS_TOKEN = os.getenv("KICK_ACCESS_TOKEN", "PEGA_AQUI_TU_ACCESS_TOKEN")

# Slug del canal objetivo
CHANNEL_SLUG = os.getenv("KICK_CHANNEL_SLUG", "tu_canal_aqui")

# Opcional: ID numérico del broadcaster (si lo sabes, es más rápido)
BROADCASTER_USER_ID = os.getenv("KICK_BROADCASTER_ID")   # dejar vacío si usas slug

INTERVAL_MINUTES = 5
JITTER_SECONDS = 40

# Mensajes variados (edita con los tuyos)
MENSAJES = [
    "Jajajaja qué buena",
    "Esto está brutal",
    "Vamos vamos",
    "Buenísima jugada",
    "Me estoy riendo solo xd",
    "Poggers",
    "Qué crack",
    "Real",
    "Esto se pone interesante",
    "Jajajajaja",
    "Buenísimo",
    "Lmao",
    "Facts",
    "Sigue así rey",
    "Qué buena reacción",
    "Estoy flipando",
    "xd",
    "No way bro",
    "Qué épico",
    "Buena buena",
]

HEADERS = {
    "Authorization": f"Bearer {ACCESS_TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

API_BASE = "https://api.kick.com/public/v1"


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def get_broadcaster_id(slug: str) -> int:
    """Obtiene el broadcaster_user_id usando el endpoint de channels."""
    if BROADCASTER_USER_ID and BROADCASTER_USER_ID.strip().isdigit():
        return int(BROADCASTER_USER_ID)

    url = f"{API_BASE}/channels"
    params = {"slug": slug}

    try:
        r = requests.get(url, headers=HEADERS, params=params, timeout=15)
        if r.status_code == 200:
            data = r.json()
            if data.get("data"):
                bid = data["data"][0]["broadcaster_user_id"]
                log(f"Broadcaster ID obtenido: {bid}")
                return bid
        log(f"No se pudo obtener broadcaster id. Respuesta: {r.status_code} {r.text[:200]}")
    except Exception as e:
        log(f"Error obteniendo broadcaster id: {e}")

    raise RuntimeError("No se pudo resolver el broadcaster_user_id. Pon BROADCASTER_USER_ID manualmente.")


def send_message(broadcaster_id: int, content: str) -> bool:
    """Envía el mensaje usando la API oficial."""
    url = f"{API_BASE}/chat"
    payload = {
        "type": "user",                    # importante para que parezca usuario normal
        "broadcaster_user_id": broadcaster_id,
        "content": content,
    }

    try:
        r = requests.post(url, json=payload, headers=HEADERS, timeout=15)
        if r.status_code in (200, 201):
            log(f"✅ Enviado: {content}")
            return True
        else:
            log(f"❌ Error {r.status_code}: {r.text[:300]}")
            # Si es 401 probablemente el token expiró o no tiene permisos
            return False
    except Exception as e:
        log(f"❌ Excepción al enviar: {e}")
        return False


def main():
    if "PEGA_AQUI" in ACCESS_TOKEN or not ACCESS_TOKEN:
        print("❌ Configura ACCESS_TOKEN (variable de entorno o en el script)")
        print("   Ejemplo: set KICK_ACCESS_TOKEN=tu_token   (Windows)")
        print("            export KICK_ACCESS_TOKEN=tu_token (Linux/Mac)")
        return

    if CHANNEL_SLUG == "tu_canal_aqui":
        print("❌ Configura CHANNEL_SLUG")
        return

    log("=== Kick Timer Bot (versión simple) ===")
    log(f"Canal: {CHANNEL_SLUG}")
    log(f"Intervalo ~{INTERVAL_MINUTES} min (+/- {JITTER_SECONDS}s)")

    try:
        broadcaster_id = get_broadcaster_id(CHANNEL_SLUG)
    except Exception as e:
        log(str(e))
        return

    log("Iniciando bucle... (Ctrl+C para parar)")

    try:
        message_index = 0
        while True:
            if not MENSAJES:
                log("No hay mensajes configurados en la lista MENSAJES.")
                time.sleep(10)
                continue

            mensaje = MENSAJES[message_index]
            log(f"Enviando mensaje ({message_index + 1}/{len(MENSAJES)})")
            send_message(broadcaster_id, mensaje)

            # Avanzar secuencialmente
            message_index = (message_index + 1) % len(MENSAJES)

            # Espera con jitter humano
            base = INTERVAL_MINUTES * 60
            jitter = random.randint(-JITTER_SECONDS, JITTER_SECONDS)
            sleep_for = max(5, base + jitter)   # mínimo 5 segundos por seguridad (útil para pruebas)

            log(f"Siguiente mensaje en {sleep_for // 60}m {sleep_for % 60}s")
            time.sleep(sleep_for)

    except KeyboardInterrupt:
        log("Bot detenido por el usuario.")


if __name__ == "__main__":
    main()
