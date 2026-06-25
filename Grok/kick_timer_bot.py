#!/usr/bin/env python3
"""
Kick.com Chat Timer Bot (como un usuario real)

Envía mensajes automáticamente cada ~5 minutos en un stream de Kick.

⚠️ ADVERTENCIA IMPORTANTE:
- Esto puede violar los Términos de Servicio de Kick si se usa para spam.
- Recomendado: Úsalo SOLO en tu propio stream o con permiso.
- Usa una cuenta secundaria (user bot) para no arriesgar tu cuenta principal.
- Varía mucho los mensajes. Evita que parezca bot.
- Respeta slowmode, followers-only, etc.
- Cuentas pueden ser baneadas por abuso.

Método recomendado (2026): Usar kickcom.py + OAuth oficial (más estable).

Instalación:
    pip install kickcom.py requests

Configuración:
1. Ve a https://kick.com/developer (o dev.kick.com) y crea una App.
2. Obtén Client ID y Client Secret.
3. En el script abajo configura CLIENT_ID, CLIENT_SECRET.
4. El flujo OAuth abrirá el navegador la primera vez para autorizar con scopes chat:write + channel:read.
5. Pon el slug del canal donde quieres comentar.
6. Edita la lista de MENSAJES para que parezcan de un usuario real.

Ejecución:
    python kick_timer_bot.py

Para detener: Ctrl + C
"""

import asyncio
import random
import sys
from datetime import datetime

# ====================== CONFIGURACIÓN ======================
# Reemplaza con tus datos de la app de Kick (obtén en developer portal)
CLIENT_ID = "01KVKVBT9W2NHZH46CZAVJ3P5A"
CLIENT_SECRET = "ea8ef730aaa7b776c5fb95cdc70285e04465067782803f89737e00fe1135e458"

# Slug del canal (ej: "xqc", "nombredecanal")
CHANNEL_SLUG = "kashee_teamcosta"

# Intervalo base en minutos
INTERVAL_MINUTES = 2

# Jitter (variación) en segundos para que no sea exactamente cada 5 min
JITTER_SECONDS = 45   # +/- 45 segundos

# Mensajes "humanos" - ¡edita esto con tus propios mensajes!
# Cuantos más y más variados, mejor. Mezcla saludos, reacciones, preguntas, etc.
MENSAJES = [
"That was a crazy hand",
"No way, dealer always gets lucky",
"I had a feeling that was coming",
"Let's gooo!",
"What would you do here?",
"That split was risky",
"Blackjack incoming",
"The cards are hot today",
"This table feels cursed",
"Dealer is farming wins.",
"That was painful to watch",
"Nice recovery",
"I would've hit there",
"Smart stand",
"The comeback is real.",
"How long have you been playing blackjack?",
"What's your biggest win?",
"The vibes are good today",
"Chat, what would you do?",
"That dealer is on fire",
"We're due for a blackjack",
"That's actually not a bad play",
"The luck is changing",
"Can't believe that worked",
"This game is wild",
]

# Si quieres mensajes más largos o con emotes personalizados, agrégalos arriba.
# ===============================================================

try:
    from kickpy import KickClient
except ImportError:
    print("❌ Falta kickcom.py. Instálalo con:")
    print("   pip install kickcom.py")
    print("   (también puedes usar pip install kickcom.py[speed] )")
    sys.exit(1)


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


async def get_broadcaster_user_id(client: KickClient, slug: str) -> int:
    """Obtiene el broadcaster_user_id a partir del slug del canal."""
    try:
        channel = await client.fetch_channel(slug=slug)
        return channel.broadcaster_user_id
    except Exception as e:
        log(f"Error obteniendo broadcaster id para '{slug}': {e}")
        raise


async def send_message(client: KickClient, broadcaster_id: int, content: str):
    """Envía un mensaje de chat como usuario normal (type='user')."""
    try:
        resp = await client.send_chat_message(
            content=content,
            message_type="user",
            broadcaster_user_id=broadcaster_id,
        )
        log(f"✅ Mensaje enviado: {content}")
        return True
    except Exception as e:
        log(f"❌ Error enviando mensaje: {e}")
        return False


async def main():
    if CLIENT_ID == "TU_CLIENT_ID_AQUI" or CLIENT_SECRET == "TU_CLIENT_SECRET_AQUI":
        print("⚠️  Por favor configura CLIENT_ID y CLIENT_SECRET en el script.")
        print("   Crea una app en https://kick.com/developer")
        return

    if CHANNEL_SLUG == "tu_canal_aqui":
        print("⚠️  Por favor configura CHANNEL_SLUG con el nombre del canal.")
        return

    log("Iniciando Kick Timer Bot...")
    log(f"Canal objetivo: {CHANNEL_SLUG}")
    log(f"Intervalo base: {INTERVAL_MINUTES} minutos (+/- {JITTER_SECONDS}s)")

    client = KickClient(CLIENT_ID, CLIENT_SECRET)

    try:
        # Autenticación (la primera vez abre navegador para OAuth)
        # Necesitamos scopes: chat:write (obligatorio) + channel:read (para obtener info del canal)
        scopes = ["chat:write", "channel:read"]
        await client.authenticate(scopes=scopes)

        log("Autenticado correctamente.")

        # Obtener broadcaster id
        broadcaster_id = await get_broadcaster_user_id(client, CHANNEL_SLUG)
        log(f"Broadcaster user ID: {broadcaster_id}")

        # Bucle principal
        message_index = 0
        while True:
            # Comprobar si hay mensajes
            if not MENSAJES:
                log("No hay mensajes configurados en la lista MENSAJES.")
                await asyncio.sleep(10)
                continue

            # Elegir mensaje secuencialmente
            mensaje = MENSAJES[message_index]
            log(f"Enviando mensaje ({message_index + 1}/{len(MENSAJES)})")

            # Enviar
            await send_message(client, broadcaster_id, mensaje)

            # Avanzar secuencialmente
            message_index = (message_index + 1) % len(MENSAJES)

            # Calcular siguiente espera con jitter
            base = INTERVAL_MINUTES * 60
            jitter = random.randint(-JITTER_SECONDS, JITTER_SECONDS)
            sleep_time = max(5, base + jitter)   # mínimo 5 segundos por seguridad (útil para pruebas)

            next_run_ts = datetime.now().timestamp() + sleep_time
            next_run = datetime.fromtimestamp(next_run_ts).strftime("%H:%M:%S")
            log(f"Próximo mensaje en ~{sleep_time // 60} min {sleep_time % 60}s (alrededor de {next_run})")

            await asyncio.sleep(sleep_time)

    except KeyboardInterrupt:
        log("Detenido por el usuario (Ctrl+C)")
    except Exception as e:
        log(f"Error fatal: {e}")
    finally:
        await client.close()
        log("Bot cerrado.")


if __name__ == "__main__":
    asyncio.run(main())
