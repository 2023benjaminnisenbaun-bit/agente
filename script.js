
// Referencias a elementos del DOM
const zonaDeChat = document.getElementById('zonaDeChat');
const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const statusMessage = document.getElementById('statusMessage');

// Configuración de tiempos
const TIMEOUT_MS = 30000;
const COOLDOWN_MS = 1500;

// Variables de control
let abortController = null;
let isWaiting = false;
let sessionIdEnMemoria = null;

// Crear o recuperar el identificador de sesión
function obtenerSessionId() {
    try {
        const guardado = localStorage.getItem('promptin_session_id');

        if (guardado) {
            return guardado;
        }

        const nuevo = generarSessionId();
        localStorage.setItem('promptin_session_id', nuevo);
        return nuevo;

    } catch (error) {
        // Si localStorage falla, conservarlo en memoria
        if (!sessionIdEnMemoria) {
            sessionIdEnMemoria = generarSessionId();
        }

        return sessionIdEnMemoria;
    }
}

// Generar un identificador único
function generarSessionId() {
    if (typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return 'sesion-' + Date.now() + '-' +
        Math.random().toString(36).substring(2);
}

// Se genera una sola vez al iniciar la aplicación
const sessionId = obtenerSessionId();

// Verificar que la URL esté configurada
function webhookConfigurado() {
    return typeof WEBHOOK_URL === 'string' &&
        WEBHOOK_URL.trim() !== '' &&
        !WEBHOOK_URL.includes('ACA VA') &&
        !WEBHOOK_URL.includes('ejemplo-webhook-prueba');
}

// Manejador del formulario
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const textoMensaje = userInput.value.trim();

    if (!textoMensaje || isWaiting) return;

    // Validar el límite de caracteres
    if (textoMensaje.length > 500) {
        setStatus('El mensaje no puede superar los 500 caracteres.', 'error');
        return;
    }

    if (!webhookConfigurado()) {
        setStatus('Falta pegar la URL de tu webhook en config.js', 'error');
        return;
    }

    agregarMensaje(textoMensaje, 'usuario');
    userInput.value = '';

    await enviarConsultaWebhook(textoMensaje);
});

// Rellenar el campo mediante sugerencias rápidas
function usarSugerencia(texto) {
    if (isWaiting) return;

    userInput.value = texto.slice(0, 500);
    userInput.focus();
}

// Agregar mensajes al chat de forma segura
function agregarMensaje(texto, remitente) {
    const divMensaje = document.createElement('div');
    divMensaje.classList.add('mensaje', remitente);

    const contenido = document.createElement('div');
    contenido.textContent = String(texto);

    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });

    divMensaje.appendChild(contenido);
    divMensaje.appendChild(timestamp);

    zonaDeChat.appendChild(divMensaje);
    zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

// Quitar envoltorios Markdown
function limpiarMarkdown(texto) {
    return texto
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
}

// Reparar saltos de línea dentro de textos JSON
function repararSaltosJSON(texto) {
    let resultado = '';
    let dentroDeTexto = false;
    let escape = false;

    for (const caracter of texto) {
        if (dentroDeTexto) {
            if (escape) {
                resultado += caracter;
                escape = false;
                continue;
            }

            if (caracter === '\\') {
                resultado += caracter;
                escape = true;
                continue;
            }

            if (caracter === '"') {
                dentroDeTexto = false;
                resultado += caracter;
                continue;
            }

            if (caracter === '\n') {
                resultado += '\\n';
                continue;
            }

            if (caracter === '\r') {
                resultado += '\\r';
                continue;
            }

            resultado += caracter;

        } else {
            if (caracter === '"') {
                dentroDeTexto = true;
            }

            resultado += caracter;
        }
    }

    return resultado;
}

// Extraer texto de una propiedad aunque el JSON esté mal formado
function extraerTextoRegex(texto) {
    const propiedades = [
        'response',
        'respuesta',
        'message',
        'mensaje'
    ];

    for (const propiedad of propiedades) {
        const patron = new RegExp(
            '"' + propiedad + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"',
            'i'
        );

        const coincidencia = texto.match(patron);

        if (coincidencia) {
            try {
                const valor = JSON.parse('"' + coincidencia[1] + '"');

                if (typeof valor === 'string' && valor.trim()) {
                    return valor;
                }
            } catch (error) {
                const valor = coincidencia[1]
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\r')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');

                if (valor.trim()) return valor;
            }
        }
    }

    return null;
}

// Interpretar la respuesta de Make
function interpretarRespuesta(textoOriginal) {
    let texto = limpiarMarkdown(textoOriginal);

    if (!texto) {
        return '(respuesta vacía)';
    }

    let datos;

    try {
        datos = JSON.parse(texto);

    } catch (error) {
        // Si parece JSON, intentar reparar los saltos de línea
        if (texto.startsWith('{') && texto.endsWith('}')) {
            try {
                datos = JSON.parse(repararSaltosJSON(texto));

            } catch (segundoError) {
                const extraido = extraerTextoRegex(texto);

                if (extraido !== null) {
                    return extraido;
                }

                return textoOriginal.trim();
            }
        } else {
            // Texto plano, números, listas y otros valores
            return texto;
        }
    }

    // Solo interpretar objetos, no listas ni valores simples
    if (datos === null || typeof datos !== 'object' ||
        Array.isArray(datos)) {
        return texto;
    }

    const propiedades = [
        'response',
        'respuesta',
        'message',
        'mensaje'
    ];

    for (const propiedad of propiedades) {
        const valor = datos[propiedad];

        if (typeof valor === 'string' && valor.trim()) {
            return valor;
        }
    }

    return 'Make respondió, pero sin el campo response';
}

// Función principal de comunicación con Make
async function enviarConsultaWebhook(mensaje) {
    const inicio = Date.now();
    let timeoutId = null;

    setEstadoCarga(true, 'El Consultor Médico está analizando tu consulta...');

    abortController = new AbortController();

    // Cancelar si pasan 30 segundos
    timeoutId = setTimeout(() => {
        abortController.abort();
    }, TIMEOUT_MS);

    try {
        // Enviar únicamente los tres campos requeridos
        const fecha = new Date().toISOString();

        const respuesta = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId,
                mensaje,
                fecha
            }),
            signal: abortController.signal
        });

        // Leer siempre como texto
        const textoRecibido = (await respuesta.text()).trim();

        if (!respuesta.ok) {
            throw new Error(
                'Make respondió con error (código ' +
                respuesta.status +
                '). Revisá que tu escenario esté en Active o que hayas apretado Run once.'
            );
        }

        const textoRespuesta = interpretarRespuesta(textoRecibido);

        agregarMensaje(textoRespuesta, 'bot');
        setStatus('Respuesta recibida correctamente.', 'success');

    } catch (error) {
        let errorMsg;

        if (error.name === 'AbortError') {
            errorMsg = 'La consulta tardó demasiado tiempo (30 segundos). Intentá nuevamente.';
        } else if (error.message.startsWith('Make respondió con error')) {
            errorMsg = error.message;
        } else if (error instanceof TypeError) {
            errorMsg = 'Error de red. No se pudo conectar con Make. Revisá tu conexión y la URL del webhook.';
        } else {
            errorMsg = 'Error del servidor. No se pudo procesar la consulta. Intentá nuevamente.';
        }

        setStatus(errorMsg, 'error');
        agregarMensaje('⚠️ ' + errorMsg, 'bot');

    } finally {
        // Cancelar el temporizador
        clearTimeout(timeoutId);
        abortController = null;

        // Garantizar una pausa mínima de 1,5 segundos
        const tiempoTranscurrido = Date.now() - inicio;
        const tiempoRestante = Math.max(
            0,
            COOLDOWN_MS - tiempoTranscurrido
        );

        await new Promise(resolve => setTimeout(resolve, tiempoRestante));

        // Liberar siempre los controles
        setEstadoCarga(false, '');
    }
}

// Actualizar estado visual y controles
function setEstadoCarga(cargando, textoEstado) {
    isWaiting = cargando;

    sendBtn.disabled = cargando;
    userInput.disabled = cargando;

    if (cargando) {
        setStatus(textoEstado, 'loading');
    }
}

// Mostrar mensajes de estado
function setStatus(texto, tipo) {
    statusMessage.textContent = texto;
    statusMessage.className = 'status-message ' + tipo;
}
