// ==========================================================================
// ADMIN JS: Hacker Monitor & Control Dashboard
// ==========================================================================

// Intercept all fetch requests to handle expired session redirects
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const res = await originalFetch(...args);
    if (res.status === 401) {
        if (!window.location.pathname.includes("login.html")) {
            console.warn("Admin session expired. Redirecting to login...");
            window.location.href = "/static/login.html";
        }
    }
    return res;
};

document.addEventListener("DOMContentLoaded", () => {
    // DOM References
    const botMonitorGrid = document.getElementById("bot-monitor-grid");
    const adminUserForm = document.getElementById("admin-user-form");
    const adminNewUsername = document.getElementById("admin_new_username");
    const adminNewPassword = document.getElementById("admin_new_password");
    const adminIsAdmin = document.getElementById("admin_is_admin");
    const adminUsersList = document.getElementById("admin-users-list");
    
    const btnClearLogs = document.getElementById("btn-clear-logs");
    const btnScrollToggle = document.getElementById("btn-scroll-toggle");
    const btnLogout = document.getElementById("btn-logout");
    const usernameDisplay = document.getElementById("username-display");
    const terminalBody = document.getElementById("terminal-body");
    const toastContainer = document.getElementById("toast-container");

    let autoScroll = true;
    let lastLogId = 0;
    let sseSource = null;
    let deletingUsers = new Set(); // usuarios siendo eliminados — se excluyen del grid rebuild

    // Custom confirm modal (browser confirm() is blocked inside iframes)
    function customConfirm(message) {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "confirm-overlay";
            overlay.innerHTML = `
                <div class="confirm-modal">
                    <i class="fa-solid fa-triangle-exclamation confirm-modal-icon"></i>
                    <p class="confirm-modal-message">${message}</p>
                    <div class="confirm-modal-actions">
                        <button class="btn btn-secondary confirm-cancel">Cancelar</button>
                        <button class="btn btn-danger confirm-ok">Confirmar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector(".confirm-ok").addEventListener("click", () => { overlay.remove(); resolve(true); });
            overlay.querySelector(".confirm-cancel").addEventListener("click", () => { overlay.remove(); resolve(false); });
            overlay.addEventListener("click", e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        });
    }

    // Toast Notifications
    function showToast(message, type = "info") {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.style.borderLeftColor = type === "success" ? "var(--hacker-green)" : (type === "danger" ? "var(--color-danger)" : "var(--color-warning)");
        
        let iconClass = "fa-circle-info";
        if (type === "success") iconClass = "fa-circle-check";
        if (type === "danger") iconClass = "fa-circle-exclamation";
        if (type === "warning") iconClass = "fa-triangle-exclamation";
        
        toast.innerHTML = `
            <i class="fa-solid ${iconClass} toast-icon" style="color: ${type === 'success' ? 'var(--hacker-green)' : ''}"></i>
            <span class="toast-message">${message}</span>
        `;
        
        toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = "slideInToast var(--transition-normal) reverse forwards";
            toast.addEventListener("animationend", () => {
                toast.remove();
            });
        }, 4000);
    }

    // Toggle Console Scroll
    btnScrollToggle.addEventListener("click", () => {
        autoScroll = !autoScroll;
        btnScrollToggle.classList.toggle("active", autoScroll);
    });

    // Clear UI Logs Console
    btnClearLogs.addEventListener("click", () => {
        terminalBody.innerHTML = '<div class="log-line log-system">> Terminal restablecida. Escuchando eventos entrantes...<span class="terminal-cursor"></span></div>';
        // Note: We don't reset lastLogId, because we don't want the server to flood us with 200 history logs again
    });

    // Format and append line inside hacker console
    function appendLog(text) {
        // Remove existing cursor
        const cursor = terminalBody.querySelector(".terminal-cursor");
        if (cursor) cursor.remove();

        const logLine = document.createElement("div");
        logLine.className = "log-line";
        
        if (text.includes("❌") || text.toLowerCase().includes("error") || text.toLowerCase().includes("fallo")) {
            logLine.classList.add("log-error");
        } else if (text.includes("✅") || text.toLowerCase().includes("éxito") || text.toLowerCase().includes("exitoso") || text.toLowerCase().includes("enviado")) {
            logLine.classList.add("log-success");
        } else if (text.includes("[SYSTEM]") || text.includes("===")) {
            logLine.classList.add("log-system");
        } else if (text.toLowerCase().includes("advertencia") || text.toLowerCase().includes("warning") || text.toLowerCase().includes("fallido")) {
            logLine.classList.add("log-warning");
        } else {
            logLine.classList.add("log-info");
        }
        
        logLine.textContent = text;
        terminalBody.appendChild(logLine);

        // Append flashing cursor at the end
        const newCursor = document.createElement("span");
        newCursor.className = "terminal-cursor";
        terminalBody.appendChild(newCursor);
        
        if (autoScroll) {
            terminalBody.scrollTop = terminalBody.scrollHeight;
        }
    }

    // Subscribe to SSE Logs
    function initLogsStream() {
        if (sseSource) {
            sseSource.close();
        }

        // Suscribirse pasando el último ID recibido para no duplicar logs
        sseSource = new EventSource(`/api/logs?last_id=${lastLogId}`);
        
        sseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                lastLogId = Math.max(lastLogId, data.id);
                appendLog(data.text);
            } catch (e) {
                console.error("Error parsing SSE JSON log:", e);
            }
        };
        
        sseSource.onerror = (err) => {
            console.error("SSE stream disconnected. Reconnecting in 3s...", err);
            sseSource.close();
            setTimeout(initLogsStream, 3000);
        };
    }

    // Poll Bot execution states
    async function loadBotsMonitoring() {
        try {
            const res = await fetch("/api/admin/bots");
            if (!res.ok) throw new Error("Could not fetch bot states");
            const bots = await res.json();

            // Guardar elemento activo para restaurar foco
            const activeUser = document.activeElement ? document.activeElement.getAttribute("data-username") : null;
            const activeClass = document.activeElement ? document.activeElement.className : null;
            const caretPos = document.activeElement ? document.activeElement.selectionStart : null;
            const activeValue = document.activeElement ? document.activeElement.value : null;

            botMonitorGrid.innerHTML = "";
            if (bots.length === 0) {
                botMonitorGrid.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--color-text-muted);">
                        <p>No hay bots registrados en el sistema.</p>
                    </div>
                `;
                return;
            }

            bots.forEach(b => {
                // Si el usuario está siendo eliminado, no lo renderices
                if (deletingUsers.has(b.username)) return;

                const card = document.createElement("div");
                card.className = "card stat-card bot-monitor-card";
                card.style.flexDirection = "column";
                card.style.alignItems = "stretch";
                card.style.padding = "1.25rem 1.5rem";

                let statusBadge = "";
                let statusTextClass = "";
                let statusDotClass = "";
                if (b.status === "running") {
                    statusBadge = "ACTIVO";
                    statusTextClass = "status-running";
                    statusDotClass = "status-running-dot";
                } else if (b.status === "error") {
                    statusBadge = "ERROR";
                    statusTextClass = "status-error";
                    statusDotClass = "status-error-dot";
                } else {
                    statusBadge = "INACTIVO";
                    statusTextClass = "";
                    statusDotClass = "status-stopped-dot";
                }

                // Generar lista de los últimos 3 mensajes
                const lastMsgs = b.last_messages || [];
                let msgsListHTML = "";
                if (lastMsgs.length > 0) {
                    msgsListHTML = lastMsgs.map((m, idx) => `
                        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(57, 255, 20, 0.1); border-radius: 6px; padding: 0.3rem 0.5rem; font-family: var(--font-mono); font-size:0.75rem; color:#a3ffd0; word-break: break-all; margin-bottom: 0.25rem;">
                            <span style="color: var(--hacker-green); font-size: 0.7rem;">[${idx + 1}]</span> "${m}"
                        </div>
                    `).join("");
                } else {
                    msgsListHTML = `<div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.02); border-radius: 6px; padding: 0.4rem 0.6rem; font-family: var(--font-mono); font-size:0.75rem; color:var(--color-text-muted); text-align:center;">Ningún mensaje enviado en esta sesión</div>`;
                }

                const errorAlert = b.error_message ? `
                    <div class="alert alert-warning" style="margin-top:0.5rem; padding: 0.4rem 0.8rem; font-size:0.75rem; border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); color: #fca5a5;">
                        <i class="fa-solid fa-circle-exclamation"></i> ${b.error_message}
                    </div>
                ` : "";

                const tokenIndicator = b.authenticated ? 
                    `<span style="color: var(--hacker-green); font-size:0.85rem;"><i class="fa-solid fa-key"></i> Vinculado</span>` : 
                    `<span style="color: var(--color-danger); font-size:0.85rem;"><i class="fa-solid fa-user-slash"></i> Desvinculado</span>`;

                // Preservar valores de campos si están bajo edición
                const schedStartVal = (activeUser === b.username && activeClass && activeClass.includes("input-sched-start")) ? activeValue : (b.schedule_start || "");
                const schedStopVal = (activeUser === b.username && activeClass && activeClass.includes("input-sched-stop")) ? activeValue : (b.schedule_stop || "");
                const clientIdVal = (activeUser === b.username && activeClass && activeClass.includes("input-client-id")) ? activeValue : (b.client_id || "");
                const clientSecretVal = (activeUser === b.username && activeClass && activeClass.includes("input-client-secret")) ? activeValue : (b.client_secret || "");
                const channelSlugVal = (activeUser === b.username && activeClass && activeClass.includes("input-channel-slug")) ? activeValue : (b.channel_slug || "");

                card.innerHTML = `
                    <div class="bot-status-header">
                        <div class="bot-name">
                            <i class="fa-solid fa-robot" style="color: ${b.status === 'running' ? 'var(--hacker-green)' : 'var(--color-text-muted)'}"></i>
                            ${b.username}
                        </div>
                        <div class="status-indicator-wrapper" style="padding: 0.25rem 0.75rem; background: rgba(0,0,0,0.3); border-color: ${b.status === 'running' ? 'var(--hacker-green)' : 'var(--border-color)'}">
                            <span class="status-text ${statusTextClass}" style="font-size: 0.75rem;">${statusBadge}</span>
                            <span class="status-dot ${statusDotClass}"></span>
                        </div>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.85rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.25rem;">
                            <span style="color: var(--color-text-sub);">Canal Objetivo:</span>
                            <select class="cyber-input input-channel-slug" data-username="${b.username}" style="padding:0.25rem 0.4rem; font-size:0.75rem; border-radius:6px; color:#fff; background:rgba(0,0,0,0.6); border:1px solid var(--hacker-border); width: 140px;">
                                <option value="kashee_teamcosta" ${channelSlugVal === 'kashee_teamcosta' ? 'selected' : ''}>kashee_teamcosta</option>
                                <option value="cryptocosta" ${channelSlugVal === 'cryptocosta' ? 'selected' : ''}>cryptocosta</option>
                            </select>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color: var(--color-text-sub);">Total Enviados:</span>
                            <span class="bot-value" style="font-weight:bold; color:#fff;">${b.messages_sent}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color: var(--color-text-sub);">Credencial Kick:</span>
                            <span>${tokenIndicator}</span>
                        </div>
                        
                        <!-- Developer Credentials Edit fields -->
                        <div style="margin-top:0.25rem; background:rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.03); border-radius:8px; padding:0.4rem;">
                            <span style="color: var(--color-text-sub); font-size:0.75rem; display:block; margin-bottom:0.25rem;"><i class="fa-solid fa-key"></i> Credenciales de Desarrollador:</span>
                            <div style="display:flex; flex-direction:column; gap:0.25rem;">
                                <input type="text" class="cyber-input input-client-id" data-username="${b.username}" placeholder="Client ID" value="${clientIdVal}" style="padding:0.25rem 0.4rem; font-size:0.75rem; border-radius:6px; color:#fff; font-family:var(--font-mono); width:100%;">
                                <input type="password" class="cyber-input input-client-secret" data-username="${b.username}" placeholder="Client Secret" value="${clientSecretVal}" style="padding:0.25rem 0.4rem; font-size:0.75rem; border-radius:6px; color:#fff; font-family:var(--font-mono); width:100%;">
                            </div>
                        </div>
                        
                        <!-- Lista de Mensajes Recientes -->
                        <div style="margin-top: 0.4rem;">
                            <span style="color: var(--color-text-sub); display:block; margin-bottom:0.25rem;"><i class="fa-solid fa-comments"></i> Mensajes Recientes (Últimos 3):</span>
                            ${msgsListHTML}
                        </div>
                        
                        ${errorAlert}

                        <!-- Controles Manuales -->
                        <div style="display: flex; gap: 0.4rem; margin-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.6rem; flex-wrap: wrap;">
                            <button class="btn btn-secondary btn-hacker-primary btn-bot-start" data-username="${b.username}" style="flex:1; padding:0.4rem 0.5rem; font-size:0.8rem; border-radius:8px; min-width: 65px;" ${b.status === 'running' || !b.authenticated ? 'disabled' : ''}>
                                <i class="fa-solid fa-play"></i> Iniciar
                            </button>
                            <button class="btn btn-secondary btn-hacker-danger btn-bot-stop" data-username="${b.username}" style="flex:1; padding:0.4rem 0.5rem; font-size:0.8rem; border-radius:8px; min-width: 65px;" ${b.status !== 'running' ? 'disabled' : ''}>
                                <i class="fa-solid fa-stop"></i> Detener
                            </button>
                            <button class="btn btn-secondary btn-bot-reset" data-username="${b.username}" style="padding:0.4rem 0.6rem; font-size:0.8rem; border-radius:8px; border-color: rgba(255,255,255,0.15);" title="Resetear contador de mensajes">
                                <i class="fa-solid fa-arrows-rotate"></i>
                            </button>
                            <button class="btn btn-secondary btn-hacker-primary btn-bot-link" data-username="${b.username}" style="padding:0.4rem 0.6rem; font-size:0.8rem; border-radius:8px;" title="Vincular Cuenta de Kick">
                                <i class="fa-brands fa-kickstarter"></i> Vincular
                            </button>
                            <button class="btn btn-secondary btn-hacker-danger btn-bot-delete" data-username="${b.username}" style="padding:0.4rem 0.6rem; font-size:0.8rem; border-radius:8px;" title="Eliminar Bot / Cuenta de Usuario" ${b.username === 'admin' ? 'disabled' : ''}>
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>

                        <!-- Automatización Horaria -->
                        <div style="margin-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.6rem;">
                            <span style="color: var(--color-text-sub); font-size: 0.78rem; display:block; margin-bottom:0.25rem;"><i class="fa-solid fa-clock"></i> Programar Automatización</span>
                            <div style="display:flex; align-items:center; gap:0.4rem;">
                                <input type="time" class="cyber-input input-sched-start" data-username="${b.username}" value="${schedStartVal}" style="flex:1; padding:0.3rem 0.5rem; font-size:0.75rem; border-radius:6px; font-family: var(--font-mono); text-align:center; color: #fff; background: rgba(0,0,0,0.6); border: 1px solid var(--hacker-border);">
                                <span style="color: var(--color-text-muted); font-size:0.8rem;">a</span>
                                <input type="time" class="cyber-input input-sched-stop" data-username="${b.username}" value="${schedStopVal}" style="flex:1; padding:0.3rem 0.5rem; font-size:0.75rem; border-radius:6px; font-family: var(--font-mono); text-align:center; color: #fff; background: rgba(0,0,0,0.6); border: 1px solid var(--hacker-border);">
                                <button class="btn btn-secondary btn-save-bot-config" data-username="${b.username}" style="padding:0.3rem 0.6rem; font-size:0.75rem; border-radius:6px; border-color: var(--hacker-green); color: var(--hacker-green);" title="Guardar Configuración">
                                    <i class="fa-solid fa-floppy-disk"></i> Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                botMonitorGrid.appendChild(card);
            });


            // Restaurar el foco y el caret si es necesario
            if (activeUser && activeClass) {
                const el = botMonitorGrid.querySelector(`input[data-username="${activeUser}"].${activeClass.split(" ").join(".")}`);
                if (el) {
                    el.focus();
                    if (caretPos !== null) {
                        el.setSelectionRange(caretPos, caretPos);
                    }
                }
            }

        } catch (err) {
            console.error("Error monitoring bots:", err);
        }
    }


    // ===== EVENT DELEGATION: un solo listener en el grid para todos los botones =====
    botMonitorGrid.addEventListener("click", async (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const target = btn.getAttribute("data-username");
        if (!target) return;

        // --- ELIMINAR ---
        if (btn.classList.contains("btn-bot-delete")) {
            if (target === "admin") {
                showToast("No puedes eliminar la cuenta de administración", "warning");
                return;
            }
            const confirmed = await customConfirm(`¿Eliminar permanentemente la cuenta "<strong>${target}</strong>"? Se detendrá su bot y se borrarán sus datos.`);
            if (!confirmed) return;

            // Marcar como eliminando (pausa el rebuild del grid para este usuario)
            deletingUsers.add(target);
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

            try {
                const res = await fetch(`/api/admin/users/${target}`, { method: "DELETE" });
                if (res.ok) {
                    // Animar y quitar la card del DOM
                    const card = btn.closest(".bot-monitor-card");
                    if (card) {
                        card.style.transition = "opacity 0.35s ease, transform 0.35s ease";
                        card.style.opacity = "0";
                        card.style.transform = "scale(0.85)";
                        setTimeout(() => {
                            card.remove();
                            deletingUsers.delete(target); // liberar lock después de quitar del DOM
                        }, 380);
                    } else {
                        deletingUsers.delete(target);
                    }
                    showToast(`Usuario "${target}" eliminado`, "success");
                    loadAdminUsersList();
                } else {
                    let detail = "Error al eliminar";
                    try { detail = (await res.json()).detail || detail; } catch(_) {}
                    showToast(detail, "danger");
                    deletingUsers.delete(target);
                    btn.disabled = false;
                    btn.innerHTML = `<i class="fa-solid fa-trash-can"></i>`;
                }
            } catch (err) {
                showToast(err.message, "danger");
                deletingUsers.delete(target);
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-trash-can"></i>`;
            }
            return;
        }

        // --- INICIAR ---
        if (btn.classList.contains("btn-bot-start")) {
            try {
                const res = await fetch(`/api/admin/bot/start/${target}`, { method: "POST" });
                if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error al iniciar"); }
                showToast(`Bot ${target} iniciado`, "success");
                loadBotsMonitoring();
            } catch (err) { showToast(err.message, "danger"); }
            return;
        }

        // --- DETENER ---
        if (btn.classList.contains("btn-bot-stop")) {
            try {
                const res = await fetch(`/api/admin/bot/stop/${target}`, { method: "POST" });
                if (!res.ok) throw new Error("Error al detener bot");
                showToast(`Bot ${target} detenido`, "info");
                loadBotsMonitoring();
            } catch (err) { showToast(err.message, "danger"); }
            return;
        }

        // --- RESETEAR CONTADOR ---
        if (btn.classList.contains("btn-bot-reset")) {
            try {
                const res = await fetch(`/api/admin/bot/reset_counter/${target}`, { method: "POST" });
                if (!res.ok) throw new Error("Error al resetear");
                showToast(`Contador de ${target} reiniciado`, "success");
                loadBotsMonitoring();
            } catch (err) { showToast(err.message, "danger"); }
            return;
        }

        // --- VINCULAR ---
        if (btn.classList.contains("btn-bot-link")) {
            showToast(`Redirigiendo para vincular Kick de ${target}...`, "info");
            setTimeout(() => { window.location.href = `/api/auth/login_oauth?target_user=${target}`; }, 1000);
            return;
        }

        // --- GUARDAR CONFIG/HORARIO ---
        if (btn.classList.contains("btn-save-bot-config")) {
            const card = btn.closest(".bot-monitor-card");
            let startVal = card.querySelector(".input-sched-start").value.trim();
            let stopVal  = card.querySelector(".input-sched-stop").value.trim();
            const clientId     = card.querySelector(".input-client-id").value.trim();
            const clientSecret = card.querySelector(".input-client-secret").value.trim();
            const channelSlug  = card.querySelector(".input-channel-slug").value;
            if (startVal.length > 5) startVal = startVal.substring(0, 5);
            if (stopVal.length  > 5) stopVal  = stopVal.substring(0, 5);
            try {
                const res = await fetch(`/api/admin/bot/schedule/${target}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ schedule_start: startVal, schedule_stop: stopVal,
                                          client_id: clientId, client_secret: clientSecret,
                                          channel_slug: channelSlug })
                });
                if (!res.ok) throw new Error("Error al guardar configuración");
                showToast(`Configuración de ${target} guardada`, "success");
                loadBotsMonitoring();
            } catch (err) { showToast(err.message, "danger"); }
            return;
        }
    }); // end botMonitorGrid delegation

    // Load active users list
    async function loadAdminUsersList() {
        try {
            const res = await fetch("/api/admin/users");
            if (!res.ok) return;
            const users = await res.json();
            
            adminUsersList.innerHTML = "";
            users.forEach(u => {
                const tr = document.createElement("tr");
                tr.style.borderBottom = "1px solid var(--hacker-border)";
                
                const rolBadge = u.is_admin ? '<span style="color: var(--hacker-green); font-weight:bold;">Admin</span>' : 'Usuario';
                const ipLabel = u.ip_activa === "Desconectado" ? '<span style="color: var(--color-text-muted);">Inactivo</span>' : `<span style="color: var(--hacker-cyan);">${u.ip_activa}</span>`;
                
                const isSelf = u.username === usernameDisplay.textContent.toLowerCase();
                const isMainAdmin = u.username === "admin";
                const deleteBtn = (isSelf || isMainAdmin) 
                    ? `<span style="color: var(--color-text-muted); font-size: 0.8rem; font-family: var(--font-ui);">Bloqueado</span>`
                    : `<button class="btn-delete-user" data-username="${u.username}" style="background:none; border:none; color: var(--color-danger); cursor:pointer; font-size: 1rem;" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>`;

                tr.innerHTML = `
                    <td style="padding: 0.6rem; text-transform: capitalize; font-weight:600; color:#fff;">${u.username}</td>
                    <td style="padding: 0.6rem;">${rolBadge}</td>
                    <td style="padding: 0.6rem;">${ipLabel}</td>
                    <td style="padding: 0.6rem; text-align: right;">${deleteBtn}</td>
                `;
                adminUsersList.appendChild(tr);
            });

            // Assign delete listeners
            document.querySelectorAll(".btn-delete-user").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const targetUser = btn.getAttribute("data-username");
                    const confirmed = await customConfirm(`¿Eliminar la cuenta "<strong>${targetUser}</strong>"? Su bot activo se detendrá y sus datos serán borrados.`);
                    if (!confirmed) return;
                    try {
                        const res = await fetch(`/api/admin/users/${targetUser}`, {
                            method: "DELETE"
                        });
                        if (res.ok) {
                            showToast(`Usuario "${targetUser}" purgado correctamente`, "success");
                            loadAdminUsersList();
                            loadBotsMonitoring();
                        } else {
                            const errData = await res.json();
                            showToast(errData.detail || "Error al eliminar usuario", "danger");
                        }
                    } catch (err) {
                        showToast("Fallo de red al eliminar", "danger");
                    }
                });
            });

        } catch (err) {
            console.error("Error loading accounts list", err);
        }
    }

    // Create user form submission
    adminUserForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const username = adminNewUsername.value.trim();
        const password = adminNewPassword.value;
        const is_admin = adminIsAdmin.checked;

        if (!username || !password) {
            showToast("Introduce un nombre de usuario y contraseña válidos", "warning");
            return;
        }

        try {
            const res = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password, is_admin })
            });

            if (res.ok) {
                showToast(`Usuario "${username}" inyectado con éxito.`, "success");
                adminNewUsername.value = "";
                adminNewPassword.value = "";
                adminIsAdmin.checked = false;
                loadAdminUsersList();
                loadBotsMonitoring();
            } else {
                const errData = await res.json();
                showToast(errData.detail || "Fallo al crear usuario", "danger");
            }
        } catch (err) {
            showToast("Error de conexión al crear usuario", "danger");
        }
    });

    // Check Auth and init
    async function checkAuthAndAdmin() {
        try {
            const res = await fetch("/api/auth/check");
            if (!res.ok) throw new Error("Unauthenticated");
            const data = await res.json();
            
            usernameDisplay.textContent = data.username;
            if (!data.is_admin) {
                // If not admin, throw out
                window.location.href = "/";
                return;
            }
            
            // Success, run routines
            loadBotsMonitoring();
            loadAdminUsersList();
            initLogsStream();
            
            // Setup intervals for real-time dashboard data
            setInterval(loadBotsMonitoring, 3000);
            setInterval(loadAdminUsersList, 5000);

        } catch (err) {
            console.error("Error verifying admin session:", err);
            window.location.href = "/static/login.html";
        }
    }

    // Logout click
    btnLogout.addEventListener("click", async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch (err) {
            console.error("Error during logout", err);
        } finally {
            window.location.href = "/static/login.html";
        }
    });

    // Run verification
    checkAuthAndAdmin();
});
