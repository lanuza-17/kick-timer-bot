// ==========================================================================
// CLIENT JS: Kick Timer Bot Dashboard
// ==========================================================================

// Interceptar todas las peticiones fetch para detectar sesión expirada (401)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const res = await originalFetch(...args);
    if (res.status === 401) {
        // Ignorar si ya estamos en la página de login para evitar bucles
        if (!window.location.pathname.includes("login.html")) {
            console.warn("Sesión no válida o cerrada. Redirigiendo a login...");
            window.location.href = "/static/login.html";
        }
    }
    return res;
};

document.addEventListener("DOMContentLoaded", () => {
    // Referencias del DOM
    const botStatusText = document.getElementById("bot-status-text");
    const botStatusDot = document.getElementById("bot-status-dot");
    
    const statStatusVal = document.getElementById("stat-status-val");
    const statChannelVal = document.getElementById("stat-channel-val");
    const statMessagesVal = document.getElementById("stat-messages-val");
    const btnStart = document.getElementById("btn-start");
    const btnStop = document.getElementById("btn-stop");
    const btnToggleSecret = document.getElementById("btn-toggle-secret");
    const btnSaveConfig = document.getElementById("btn-save-config");
    const btnClearLogs = document.getElementById("btn-clear-logs");
    const btnScrollToggle = document.getElementById("btn-scroll-toggle");
    const btnLogout = document.getElementById("btn-logout");
    const usernameDisplay = document.getElementById("username-display");
    
    // Panel de Administración (Admin)
    const adminCard = document.getElementById("admin-card");
    const adminUserForm = document.getElementById("admin-user-form");
    const adminNewUsername = document.getElementById("admin_new_username");
    const adminNewPassword = document.getElementById("admin_new_password");
    const adminIsAdmin = document.getElementById("admin_is_admin");
    const adminUsersList = document.getElementById("admin-users-list");
    
    const configForm = document.getElementById("config-form");
    const terminalBody = document.getElementById("terminal-body");
    const toastContainer = document.getElementById("toast-container");
    
    // Inputs de Configuración
    const inputClientId = document.getElementById("client_id");
    const inputClientSecret = document.getElementById("client_secret");
    const inputChannelSlug = document.getElementById("channel_slug");
    const inputRedirectUri = document.getElementById("redirect_uri");
    const inputIntervalMinutes = document.getElementById("interval_minutes");
    const inputJitterSeconds = document.getElementById("jitter_seconds");
    const inputMessages = document.getElementById("messages");
    
    // Nuevos Controles de Mensajes V2 y Scheduler
    const selectMsgTemplate = document.getElementById("msg-template");
    const inputNewTemplateName = document.getElementById("new-template-name");
    const btnSaveTemplate = document.getElementById("btn-save-template");
    const btnDeleteTemplate = document.getElementById("btn-delete-template");
    const inputScheduleStart = document.getElementById("schedule_start");
    const inputScheduleStop = document.getElementById("schedule_stop");
    const btnShuffleMessages = document.getElementById("btn-shuffle-messages");

    let autoScroll = true;
    let isAuthenticated = false;
    let lastLogId = 0;
    let sseSource = null;
    let userTemplates = {}; // Diccionario local cargado desde la configuración del usuario

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

    // Toast de notificación
    function showToast(message, type = "info") {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        
        let iconClass = "fa-circle-info";
        if (type === "success") iconClass = "fa-circle-check";
        if (type === "danger") iconClass = "fa-circle-exclamation";
        if (type === "warning") iconClass = "fa-triangle-exclamation";
        
        toast.innerHTML = `
            <i class="fa-solid ${iconClass} toast-icon"></i>
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

    // Renderizar select desplegable de plantillas
    function renderTemplateSelect() {
        selectMsgTemplate.innerHTML = '<option value="">-- Mis Plantillas --</option>';
        Object.keys(userTemplates).forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            selectMsgTemplate.appendChild(opt);
        });
    }

    // Guardar plantillas actuales en el servidor
    async function saveTemplatesToServer() {
        const messagesArray = inputMessages.value
            .split("\n")
            .map(msg => msg.trim())
            .filter(msg => msg.length > 0);
            
        const configData = {
            client_id: inputClientId.value.trim(),
            client_secret: inputClientSecret.value.trim(),
            channel_slug: inputChannelSlug.value.trim(),
            redirect_uri: inputRedirectUri.value.trim(),
            interval_minutes: parseInt(inputIntervalMinutes.value),
            jitter_seconds: parseInt(inputJitterSeconds.value),
            messages: messagesArray,
            templates: userTemplates,
            schedule_start: inputScheduleStart.value.trim(),
            schedule_stop: inputScheduleStop.value.trim()
        };
        
        try {
            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(configData)
            });
            if (!res.ok) throw new Error("Error de respuesta del servidor");
        } catch (err) {
            showToast("No se pudo sincronizar las plantillas con el servidor: " + err.message, "danger");
        }
    }

    // Cargar Plantilla seleccionada
    selectMsgTemplate.addEventListener("change", () => {
        const name = selectMsgTemplate.value;
        if (name && userTemplates[name]) {
            inputMessages.value = userTemplates[name].join("\n");
            showToast(`Plantilla "${name}" cargada con éxito`, "success");
        }
    });

    // Guardar nueva plantilla
    btnSaveTemplate.addEventListener("click", async () => {
        const name = inputNewTemplateName.value.trim();
        if (!name) {
            showToast("Escribe un nombre para la plantilla en la caja de texto primero", "warning");
            inputNewTemplateName.focus();
            return;
        }

        const lines = inputMessages.value
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (lines.length === 0) {
            showToast("Escribe algunos mensajes en el cuadro antes de guardar la plantilla", "warning");
            inputMessages.focus();
            return;
        }

        userTemplates[name] = lines;
        await saveTemplatesToServer();
        renderTemplateSelect();
        selectMsgTemplate.value = name;
        inputNewTemplateName.value = "";
        showToast(`Plantilla "${name}" guardada correctamente`, "success");
    });

    // Eliminar plantilla seleccionada
    btnDeleteTemplate.addEventListener("click", async () => {
        const name = selectMsgTemplate.value;
        if (!name) {
            showToast("Primero selecciona la plantilla que deseas borrar", "warning");
            return;
        }

        const confirmed = await customConfirm(`¿Eliminar la plantilla "<strong>${name}</strong>"?`);
        if (confirmed) {
            delete userTemplates[name];
            await saveTemplatesToServer();
            renderTemplateSelect();
            inputMessages.value = "";
            showToast(`Plantilla "${name}" eliminada correctamente`, "info");
        }
    });

    // Mezclar mensajes
    btnShuffleMessages.addEventListener("click", () => {
        const lines = inputMessages.value
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);
        if (lines.length === 0) {
            showToast("No hay mensajes en la lista para mezclar.", "warning");
            return;
        }
        for (let i = lines.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [lines[i], lines[j]] = [lines[j], lines[i]];
        }
        inputMessages.value = lines.join("\n");
        showToast("Mensajes ordenados aleatoriamente", "success");
    });

    // Toggle de visibilidad de contraseña
    btnToggleSecret.addEventListener("click", () => {
        const type = inputClientSecret.type === "password" ? "text" : "password";
        inputClientSecret.type = type;
        const icon = btnToggleSecret.querySelector("i");
        icon.className = type === "password" ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
    });

    // Cargar Configuración del usuario actual
    async function loadConfig() {
        try {
            const res = await fetch("/api/config");
            if (!res.ok) throw new Error("Error obteniendo configuración");
            const config = await res.json();
            
            inputClientId.value = config.client_id || "";
            inputClientSecret.value = config.client_secret || "";
            inputChannelSlug.value = config.channel_slug || "kashee_teamcosta";
            inputRedirectUri.value = config.redirect_uri || "http://localhost:5000/callback";
            inputIntervalMinutes.value = config.interval_minutes || 5;
            inputJitterSeconds.value = config.jitter_seconds || 45;
            inputMessages.value = (config.messages || []).join("\n");
            inputScheduleStart.value = config.schedule_start || "";
            inputScheduleStop.value = config.schedule_stop || "";
            
            // Cargar y mostrar plantillas
            userTemplates = config.templates || {};
            renderTemplateSelect();
        } catch (err) {
            showToast("No se pudo cargar la configuración: " + err.message, "danger");
        }
    }

    // Guardar Configuración
    configForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        let schedStart = inputScheduleStart.value.trim();
        let schedStop = inputScheduleStop.value.trim();
        
        if (schedStart.length > 5) schedStart = schedStart.substring(0, 5);
        if (schedStop.length > 5) schedStop = schedStop.substring(0, 5);
        
        const messagesArray = inputMessages.value
            .split("\n")
            .map(msg => msg.trim())
            .filter(msg => msg.length > 0);
            
        const configData = {
            client_id: inputClientId.value.trim(),
            client_secret: inputClientSecret.value.trim(),
            channel_slug: inputChannelSlug.value.trim(),
            redirect_uri: inputRedirectUri.value.trim(),
            interval_minutes: parseInt(inputIntervalMinutes.value),
            jitter_seconds: parseInt(inputJitterSeconds.value),
            messages: messagesArray,
            templates: userTemplates,
            schedule_start: schedStart,
            schedule_stop: schedStop
        };
        
        try {
            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(configData)
            });
            
            if (!res.ok) throw new Error("Error en servidor al guardar");
            showToast("Configuración guardada y aplicada con éxito", "success");
            loadStatus();
        } catch (err) {
            showToast("Error al guardar: " + err.message, "danger");
        }
    });

    // Obtener Estado del Bot y Autenticación de Kick
    async function loadStatus() {
        try {
            const res = await fetch("/api/status");
            if (!res.ok) throw new Error("Error al consultar el estado");
            const status = await res.json();

            // Actualizar canal y mensajes enviados
            statChannelVal.textContent = status.current_channel || "-";
            statMessagesVal.textContent = status.messages_sent;
            
            botStatusText.className = "status-text";
            botStatusDot.className = "status-dot";
            
            if (status.status === "running") {
                botStatusText.textContent = "Ejecutándose";
                botStatusText.classList.add("status-running");
                botStatusDot.classList.add("status-running-dot");
                statStatusVal.textContent = "Activo";
                statStatusVal.style.color = "var(--color-kick)";
                btnStart.disabled = true;
                btnStop.disabled = false;
            } else if (status.status === "error") {
                botStatusText.textContent = "Error";
                botStatusText.classList.add("status-error");
                botStatusDot.classList.add("status-error-dot");
                statStatusVal.textContent = "Fallo";
                statStatusVal.style.color = "var(--color-danger)";
                btnStart.disabled = false;
                btnStop.disabled = true;
            } else {
                botStatusText.textContent = "Detenido";
                botStatusDot.classList.add("status-stopped-dot");
                statStatusVal.textContent = "Inactivo";
                statStatusVal.style.color = "var(--color-text-sub)";
                btnStart.disabled = false;
                btnStop.disabled = true;
            }
        } catch (err) {
            console.error("Error cargando status:", err);
        }
    }

    // Controles del Bot: Iniciar
    btnStart.addEventListener("click", async () => {
        try {
            const res = await fetch("/api/bot/start", { method: "POST" });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Error al iniciar bot");
            }
            showToast("Comando de inicio enviado", "success");
            loadStatus();
        } catch (err) {
            showToast(err.message, "danger");
        }
    });

    // Controles del Bot: Detener
    btnStop.addEventListener("click", async () => {
        try {
            const res = await fetch("/api/bot/stop", { method: "POST" });
            if (!res.ok) throw new Error("Error al detener bot");
            showToast("Bot detenido correctamente", "info");
            loadStatus();
        } catch (err) {
            showToast(err.message, "danger");
        }
    });


    // Limpiar logs de la consola
    btnClearLogs.addEventListener("click", () => {
        terminalBody.innerHTML = '<div class="log-line log-system">Consola limpia.</div>';
    });

    // Auto-scroll toggle
    btnScrollToggle.addEventListener("click", () => {
        autoScroll = !autoScroll;
        btnScrollToggle.classList.toggle("active", autoScroll);
    });

    // Formatear líneas de log para pintar en la terminal
    function appendLog(text) {
        const logLine = document.createElement("div");
        logLine.className = "log-line";
        
        if (text.includes("❌") || text.toLowerCase().includes("error") || text.toLowerCase().includes("fallo")) {
            logLine.classList.add("log-error");
        } else if (text.includes("✅") || text.toLowerCase().includes("éxito") || text.toLowerCase().includes("exitoso") || text.includes("Enviado") || text.includes("enviado")) {
            logLine.classList.add("log-success");
        } else if (text.includes("===") || text.includes("Consola") || text.includes("[SYSTEM]")) {
            logLine.classList.add("log-system");
        } else if (text.toLowerCase().includes("advertencia") || text.toLowerCase().includes("warning")) {
            logLine.classList.add("log-warning");
        } else {
            logLine.classList.add("log-info");
        }
        
        logLine.textContent = text;
        terminalBody.appendChild(logLine);
        
        if (autoScroll) {
            terminalBody.scrollTop = terminalBody.scrollHeight;
        }
    }

    // Inicializar Transmisión de Logs (SSE)
    function initLogsStream() {
        if (sseSource) {
            sseSource.close();
        }
        
        sseSource = new EventSource(`/api/logs?last_id=${lastLogId}`);
        
        sseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                lastLogId = Math.max(lastLogId, data.id);
                appendLog(data.text);
            } catch (e) {
                console.error("Error al parsear log SSE:", e);
            }
        };
        
        sseSource.onerror = (err) => {
            console.error("Error en flujo de logs SSE. Intentando reconectar...", err);
            sseSource.close();
            setTimeout(initLogsStream, 3000);
        };
    }

    // Manejar notificaciones por parámetros URL
    function checkUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const auth = params.get("auth");
        const error = params.get("error");
        
        if (auth === "success") {
            showToast("¡Cuenta de Kick vinculada con éxito!", "success");
        } else if (auth === "error" || auth === "failed") {
            showToast(`Fallo al vincular cuenta: ${error || "Error desconocido"}`, "danger");
        } else if (auth === "invalid_state") {
            showToast("Fallo al vincular: Estado inválido (posible CSRF)", "danger");
        }
        
        if (auth) {
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    }

    // Cerrar sesión
    btnLogout.addEventListener("click", async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch (err) {
            console.error("Error al cerrar sesión", err);
        } finally {
            window.location.href = "/static/login.html";
        }
    });

    // ----------------- CONTROL DE ADMINISTRADOR -----------------
    async function checkAuthAndAdmin() {
        try {
            const res = await fetch("/api/auth/check");
            if (!res.ok) throw new Error("No autenticado");
            const data = await res.json();
            
            usernameDisplay.textContent = data.username;
            
            if (data.is_admin) {
                adminCard.classList.remove("hidden");
                loadAdminUsersList();
            } else {
                adminCard.classList.add("hidden");
            }
        } catch (err) {
            console.error("Error verificando sesión:", err);
        }
    }

    async function loadAdminUsersList() {
        try {
            const res = await fetch("/api/admin/users");
            if (!res.ok) return;
            const users = await res.json();
            
            adminUsersList.innerHTML = "";
            users.forEach(u => {
                const tr = document.createElement("tr");
                tr.style.borderBottom = "1px solid var(--border-color)";
                
                const rolBadge = u.is_admin ? '<span style="color: var(--color-info); font-weight:bold;">Admin</span>' : 'Usuario';
                const ipLabel = u.ip_activa === "Desconectado" ? '<span style="color: var(--color-text-muted);">Inactivo</span>' : `<span style="color: var(--color-success);">${u.ip_activa}</span>`;
                
                // No mostrar botón de borrar en el admin principal o el usuario logueado
                const isSelf = u.username === usernameDisplay.textContent.toLowerCase();
                const isMainAdmin = u.username === "admin";
                const deleteBtn = (isSelf || isMainAdmin) 
                    ? `<span style="color: var(--color-text-muted); font-size: 0.8rem;">Bloqueado</span>`
                    : `<button class="btn-delete-user" data-username="${u.username}" style="background:none; border:none; color: var(--color-danger); cursor:pointer; font-size: 1rem;" title="Eliminar"><i class="fa-solid fa-trash"></i></button>`;

                tr.innerHTML = `
                    <td style="padding: 0.5rem; text-transform: capitalize; font-weight:600;">${u.username}</td>
                    <td style="padding: 0.5rem;">${rolBadge}</td>
                    <td style="padding: 0.5rem;">${ipLabel}</td>
                    <td style="padding: 0.5rem; text-align: right;">${deleteBtn}</td>
                `;
                adminUsersList.appendChild(tr);
            });

            // Asignar escuchadores a los botones de borrar
            document.querySelectorAll(".btn-delete-user").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const targetUser = btn.getAttribute("data-username");
                    const confirmed = await customConfirm(`¿Eliminar al usuario "<strong>${targetUser}</strong>"? Se detendrá su bot si está activo.`);
                    if (!confirmed) return;
                    try {
                        const res = await fetch(`/api/admin/users/${targetUser}`, {
                            method: "DELETE"
                        });
                        if (res.ok) {
                            showToast(`Usuario "${targetUser}" eliminado`, "info");
                            loadAdminUsersList();
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
            console.error("Error al cargar la lista de usuarios", err);
        }
    }

    // Formulario de creación de usuario
    adminUserForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const username = adminNewUsername.value.trim();
        const password = adminNewPassword.value;
        const is_admin = adminIsAdmin.checked;

        if (!username || !password) {
            showToast("Por favor introduce usuario y contraseña", "warning");
            return;
        }

        try {
            const res = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password, is_admin })
            });

            if (res.ok) {
                showToast(`Usuario "${username}" creado correctamente.`, "success");
                adminNewUsername.value = "";
                adminNewPassword.value = "";
                adminIsAdmin.checked = false;
                loadAdminUsersList();
            } else {
                const errData = await res.json();
                showToast(errData.detail || "Error al crear usuario", "danger");
            }
        } catch (err) {
            showToast("Error de conexión al crear usuario", "danger");
        }
    });

    // Carga inicial y temporizadores
    checkAuthAndAdmin().then(() => {
        loadConfig().then(() => {
            loadStatus();
            initLogsStream();
            checkUrlParams();
        });
    });

    // Polling del estado del bot cada 3 segundos
    setInterval(loadStatus, 3000);

    // =========================================================
    // MOBILE TAB NAVIGATION
    // Only activates on screens ≤768px; desktop is untouched.
    // =========================================================
    const MOBILE_BREAKPOINT = 768;

    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    // Map each tab name to the data-tab-section elements it should show.
    // "estado" shows: stats-grid + control-card
    // "config"  shows: panel-section (left column, minus control-card)
    // "consola" shows: terminal-section
    const tabMap = {
        estado:  () => document.querySelectorAll('.stats-grid[data-tab-section], .control-card[data-tab-section]'),
        config:  () => document.querySelectorAll('.panel-section[data-tab-section]'),
        consola: () => document.querySelectorAll('.terminal-section[data-tab-section]'),
    };

    function activateMobileTab(tabName) {
        // Hide all tab sections
        document.querySelectorAll('[data-tab-section]').forEach(el => {
            el.classList.remove('tab-active');
        });

        // Show the selected tab sections
        const targets = tabMap[tabName];
        if (targets) {
            targets().forEach(el => el.classList.add('tab-active'));
        }

        // Update nav button states
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Scroll content area to top on tab switch
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function initMobileNav() {
        if (!isMobile()) return;
        // Activate default tab
        activateMobileTab('estado');
        // Wire nav buttons
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => activateMobileTab(btn.dataset.tab));
        });
    }

    // Re-evaluate on resize (handles rotation / DevTools toggle)
    let mobileNavInitialized = false;
    function handleResize() {
        if (isMobile() && !mobileNavInitialized) {
            mobileNavInitialized = true;
            initMobileNav();
        } else if (!isMobile()) {
            // Remove tab-active classes so desktop CSS takes over
            document.querySelectorAll('[data-tab-section]').forEach(el => {
                el.classList.remove('tab-active');
            });
            mobileNavInitialized = false;
        }
    }

    window.addEventListener('resize', handleResize);
    handleResize(); // run on load
});
