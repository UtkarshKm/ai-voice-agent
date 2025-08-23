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
    let mediaStreamSource = null;
    let scriptProcessor = null;
    let state = 'idle';
    let fullTranscript = '';
    let audioChunks = []; // To hold incoming audio chunks

    const setState = (newState) => {
        state = newState;
        updateUI();
    };

    const updateUI = () => {
        recordBtn.dataset.state = state;
        recordBtn.classList.remove(
            'bg-blue-600', 'hover:bg-blue-700', 'pulse-ring',
            'bg-red-600', 'hover:bg-red-700', 'bg-gray-400', 'cursor-not-allowed'
        );

        switch (state) {
            case 'idle':
                statusEl.textContent = "Click to start recording";
                recordBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
                recordBtn.disabled = false;
                break;
            case 'recording':
                statusEl.textContent = "Recording... Click to stop";
                recordBtn.classList.add('pulse-ring', 'bg-red-600', 'hover:bg-red-700');
                recordBtn.disabled = false;
                break;
            case 'processing':
                statusEl.textContent = "AI is thinking...";
                recordBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
                recordBtn.disabled = true;
                break;
        }
    };

    // Helper to convert buffer to base64
    function bufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    const startRecording = async () => {
        if (state !== 'idle') return;
        setState('recording');
        fullTranscript = ''; // Reset transcript
        audioChunks = []; // Reset audio chunks

        try {
            websocket = new WebSocket(`ws://${window.location.host}/ws`);
            websocket.onopen = () => {
                console.log("WebSocket connected. Sending config.");
                // Send session configuration
                websocket.send(JSON.stringify({
                    type: "config",
                    session_id: window.chatSessionId,
                    sample_rate: 16000
                }));
            };

            websocket.onerror = (e) => {
                console.error("WebSocket error:", e);
                showNotification("Connection error. Please refresh.", "error");
                setState('idle');
            };

            websocket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                switch (message.type) {
                    case 'transcript':
                        if (message.data) {
                            displayPartialTranscript(message.data);
                            fullTranscript += message.data + ' ';
                        }
                        break;
                    case 'llm_response':
                        displayLlmResponse(message.text);
                        setState('idle'); // Ready for next input
                        break;
                    case 'audio':
                        console.log("Received audio chunk (base64)");
                        audioChunks.push(message.data);
                        break;
                    case 'error':
                        showNotification(message.detail, 'error');
                        setState('idle');
                        break;
                }
            };

            websocket.onclose = () => {
                console.log("WebSocket disconnected.");
                setState('idle'); // Reset state when connection closes
            };

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            mediaStreamSource = audioContext.createMediaStreamSource(stream);
            scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = (event) => {
                const pcmData = event.inputBuffer.getChannelData(0);
                const int16Pcm = new Int16Array(pcmData.length);
                for (let i = 0; i < pcmData.length; i++) {
                    int16Pcm[i] = Math.max(-1, Math.min(1, pcmData[i])) * 32767;
                }

                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    // Send audio data as base64 string
                    websocket.send(JSON.stringify({
                        type: "audio",
                        data: bufferToBase64(int16Pcm.buffer)
                    }));
                }
            };

            mediaStreamSource.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);

        } catch (err) {
            console.error("Microphone error", err);
            showNotification("Microphone access denied. Please allow microphone access.", "error");
            setState('idle');
        }
    };

    const stopRecording = () => {
        if (state !== 'recording') return;
        setState('processing');

        // Stop audio processing
        if (audioContext) {
            audioContext.close().then(() => {
                audioContext = null;
                mediaStreamSource = null;
                scriptProcessor = null;
            });
        }

        if (fullTranscript.trim()) {
            displayFinalTranscript(fullTranscript);
            // Send the final transcript to the server over WebSocket
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify({
                    type: "transcript",
                    data: fullTranscript.trim()
                }));
            }
        } else {
            showNotification("No speech detected.", "warning");
            setState('idle');
            if (websocket) {
                websocket.close(); // Close the connection if no speech was detected
            }
        }
    };

    const displayPartialTranscript = (text) => {
        let el = document.getElementById('partial-transcript');
        if (!el) {
            el = document.createElement('div');
            el.id = 'partial-transcript';
            el.className = 'p-4 bg-gray-100 dark:bg-gray-700 rounded-lg mb-4 opacity-60';
            conversationEl.appendChild(el);
        }
        el.textContent = text;
        conversationEl.scrollTop = conversationEl.scrollHeight;
    };

    const displayFinalTranscript = (text) => {
        let partialEl = document.getElementById('partial-transcript');
        if (partialEl) partialEl.remove();

        const el = document.createElement('div');
        el.className = 'p-4 bg-gray-200 dark:bg-gray-800 rounded-lg mb-4 text-right';
        el.innerHTML = `<strong class="font-semibold block text-blue-600 dark:text-blue-400">You</strong>${text}`;
        conversationEl.appendChild(el);
        conversationEl.scrollTop = conversationEl.scrollHeight;
    };

    const displayLlmResponse = (text) => {
        const el = document.createElement('div');
        el.className = 'p-4 bg-blue-50 dark:bg-blue-900/50 rounded-lg mb-4';
        el.innerHTML = `<strong class="font-semibold block text-green-600 dark:text-green-400">AI Agent</strong>${text}`;
        conversationEl.appendChild(el);
        conversationEl.scrollTop = conversationEl.scrollHeight;
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