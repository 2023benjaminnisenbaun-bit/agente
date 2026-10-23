// Referencias a elementos del DOM usando los nombres exactos
const zonaDeChat = document.getElementById('zonaDeChat');
const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const statusMessage = document.getElementById('statusMessage');

// Variables para control de tiempo y cancelación
let abortController = null;
let isWaiting = false;
const TIMEOUT_MS = 10000; // Tiempo límite de 10 segundos
const COOLDOWN_MS = 2000; // Temporizador entre envíos (2 segundos)

// Manejador del evento Submit del formulario
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const textoMensaje = userInput.value.trim();

    if (!textoMensaje || isWaiting) return;

    // Agregar mensaje del usuario en la zona de chat
    agregarMensaje(textoMensaje, 'usuario');
    userInput.value = '';

    // Iniciar el proceso de envío asíncrono
    await enviarConsultaWebhook(textoMensaje);
});

// Función para rellenar el input mediante botones rápidos
function usarSugerencia(texto) {
    userInput.value = texto;
    userInput.focus();
}

// Función para agregar burbujas al DOM dentro de "zona de chat"
function agregarMensaje(texto, remitente) {
    const divMensaje = document.createElement('div');
    divMensaje.classList.add('mensaje', remitente);

    const horaActual = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    divMensaje.innerHTML = `
        <div>${escapeHTML(texto)}</div>
        <span class="timestamp">${horaActual}</span>
    `;

    zonaDeChat.appendChild(divMensaje);
    
    // Auto-scroll al último mensaje
    zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

// Función asíncrona principal de comunicación
async function enviarConsultaWebhook(mensaje) {
    // Configurar estado de carga e inhabilitar envío
    setEstadoCarga(true, 'El Consultor Médico está analizando tu consulta...');
    
    // Configurar AbortController para el tiempo límite
    abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mensaje: mensaje }),
            signal: abortController.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Error en el servidor: ${response.status}`);
        }

        // Intenta obtener respuesta JSON o Texto
        let datosRespuesta;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const json = await response.json();
            datosRespuesta = json.respuesta || json.message || JSON.stringify(json);
        } else {
            datosRespuesta = await response.text();
        }

        // Si el webhook devuelve vacío o texto genérico, simular respuesta
        const textoRespuesta = datosRespuesta || "Hemos recibido tu consulta sobre el trámite médico. Un asesor revisará los detalles.";
        
        agregarMensaje(textoRespuesta, 'bot');
        setStatus('', '');

    } catch (error) {
        let errorMsg = 'No se pudo conectar con el servidor. Intentalo más tarde.';
        
        if (error.name === 'AbortError') {
            errorMsg = 'La consulta tardó demasiado tiempo. Solicitud cancelada.';
        }

        setStatus(errorMsg, 'error');
        agregarMensaje(`⚠️ ${errorMsg}`, 'bot');
    } finally {
        // Enfriamiento (cooldown) de protección contra múltiples envíos
        setTimeout(() => {
            setEstadoCarga(false, '');
        }, COOLDOWN_MS);
    }
}

// Actualiza el estado visual del botón e indicador
function setEstadoCarga(cargando, textoEstado) {
    isWaiting = cargando;
    sendBtn.disabled = cargando;
    
    if (cargando) {
        setStatus(textoEstado, 'loading');
    }
}

// Actualizar mensaje de estado en pantalla
function setStatus(texto, tipo) {
    statusMessage.textContent = texto;
    statusMessage.className = `status-message ${tipo}`;
}

// Función de seguridad para evitar inyección HTML
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
