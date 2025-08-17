// --- Configuration ---
const CONFIG = {
    MAX_RECORDING_TIME: 30000, // 30 seconds
    AUTO_RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
    REQUEST_TIMEOUT: 35000, // 35 seconds (slightly more than backend timeout)
};

// --- Utility Functions ---
async function fetchWithRetry(url, options, retries = CONFIG.AUTO_RETRY_ATTEMPTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) return response;
            if (response.status === 429 || response.status === 504) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
                continue;
            }
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('Request timeout - please try again');
            if (i === retries - 1) throw error;
            console.warn(`Request failed, attempt ${i + 1}/${retries}:`, error.message);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
        }
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 transform translate-x-full opacity-0`;
    
    const typeClasses = {
        info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
        success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200',
        warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200',
        error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200'
    };
    notification.classList.add(...(typeClasses[type] || typeClasses.info).split(' '));

    notification.innerHTML = `<p class="text-sm font-medium">${message}</p>`;
    container.appendChild(notification);

    // Animate in
    requestAnimationFrame(() => {
        notification.style.transform = 'translateX(0)';
        notification.style.opacity = '1';
    });

    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}


// --- Session Management ---
(function() {
    let sessionId = new URLSearchParams(window.location.search).get("session");
    if (!sessionId) {
        sessionId = crypto.randomUUID();
        const newUrl = `${window.location.pathname}?session=${sessionId}${window.location.hash}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);
    }
    window.chatSessionId = sessionId;

    const sessionIdDisplay = document.getElementById("session-id-display");
    if (sessionIdDisplay) {
        sessionIdDisplay.textContent = sessionId.split('-')[0];
        sessionIdDisplay.parentElement.title = `Full Session ID: ${sessionId}`;
    }

    const newChatButton = document.getElementById('new-chat-button');
    if (newChatButton) {
        newChatButton.addEventListener('click', () => {
            window.location.href = window.location.pathname;
        });
    }
})();


// --- Conversational AI Logic ---
(function setupLlmQueryBot() {
const recordBtn = document.getElementById("record-button");
    const statusEl = document.getElementById("llmStatus");
    const conversationEl = document.getElementById("llmConversation");

    if (!recordBtn || !statusEl || !conversationEl) {
        console.error("Required UI elements missing");
        return;
    }

    let websocket = null;
    let audioContext = null;
    let state = 'idle';

    const setState = (newState) => {
        state = newState;
        updateUI();
    };

    const updateUI = () => {
        recordBtn.dataset.state = state;
        switch (state) {
            case 'idle':
                statusEl.textContent = "Click to start recording";
                recordBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
                break;
            case 'recording':
                statusEl.textContent = "Recording... Click to stop";
                recordBtn.classList.add('pulse-ring', 'bg-red-600', 'hover:bg-red-700');
                break;
        }
    };

    const startRecording = async () => {
        if (state !== 'idle') return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // MATCH SERVER FORMAT (16kHz mono)
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(stream);
            
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (event) => {
                const floatData = event.inputBuffer.getChannelData(0);
                const pcmData = new Int16Array(floatData.length);
                
                // CONVERT TO 16-BIT PCM
                for (let i = 0; i < floatData.length; i++) {
                    pcmData[i] = floatData[i] * 32767;
                }
                
                // SEND RAW PCM OVER WEBSOCKET
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    websocket.send(pcmData.buffer);
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            // CONNECT TO SERVER WEBSOCKET
            websocket = new WebSocket(`ws://${window.location.host}/ws`);
            websocket.onopen = () => console.log("WebSocket connected");
            websocket.onerror = (e) => console.error("WebSocket error", e);
            
            setState('recording');
            
        } catch (err) {
            console.error("Microphone error", err);
            showNotification("Microphone access denied", "error");
            setState('idle');
        }
    };

    const stopRecording = () => {
        if (state !== 'recording') return;
        
        // CLEAN UP RESOURCES
        if (websocket) {
            websocket.close();
            websocket = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        
        setState('idle');
    };

    recordBtn.addEventListener('click', () => {
        if (state === 'idle') startRecording();
        else if (state === 'recording') stopRecording();
    });

    updateUI();
})();

// --- Global Error Handlers ---
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showNotification('An unexpected error occurred', 'error');
});

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const recordBtn = document.getElementById('record-button');
        if (recordBtn && recordBtn.dataset.state === 'recording') {
            recordBtn.click();
        }
    }
});

// --- Connection Status Monitoring ---
(function setupConnectionStatus() {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    const updateStatus = () => {
        if (!statusDot || !statusText) return;
        if (navigator.onLine) {
            statusDot.style.backgroundColor = '#10B981'; // emerald-500
            statusText.textContent = 'Online';
        } else {
            statusDot.style.backgroundColor = '#EF4444'; // red-500
            statusText.textContent = 'Offline';
        }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
})();