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


// --- Session Management & Persona Persistence ---
(function() {
    console.log("Session management starting...");
    const urlParams = new URLSearchParams(window.location.search);
    let sessionId = urlParams.get("session");
    const persona = urlParams.get("persona") || 'default';

    // Restore persona dropdown selection on load
    const personaSelectEl = document.getElementById('persona-select');
    if (personaSelectEl) {
        personaSelectEl.value = persona;
    }

    // If no session ID, create one. Preserve persona in URL.
    if (!sessionId) {
        console.log("No session ID found. Creating a new one.");
        sessionId = crypto.randomUUID();
        const newUrl = `${window.location.pathname}?session=${sessionId}&persona=${persona}${window.location.hash}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);
    }
    window.chatSessionId = sessionId;

    // Update session ID display
    const sessionIdDisplay = document.getElementById("session-id-display");
    if (sessionIdDisplay) {
        sessionIdDisplay.textContent = sessionId.split('-')[0];
        sessionIdDisplay.parentElement.title = `Full Session ID: ${sessionId}`;
    }

    // Handle "New Chat" button click
    const newChatButton = document.getElementById('new-chat-button');
    if (newChatButton) {
        newChatButton.addEventListener('click', () => {
            // Start a new session, but keep the current persona
            const currentPersona = personaSelectEl ? personaSelectEl.value : 'default';
            window.location.href = `${window.location.pathname}?persona=${currentPersona}`;
        });
    }
})();


// --- Conversational AI Logic ---
(function setupLlmQueryBot() {
    const recordBtn = document.getElementById("record-button");
    const statusEl = document.getElementById("llmStatus");
    const conversationEl = document.getElementById("llmConversation");
    const personaSelectEl = document.getElementById("persona-select"); // Get persona selector

    if (!recordBtn || !statusEl || !conversationEl || !personaSelectEl) { // Check for persona selector
        console.error("Required UI elements missing");
        return;
    }

    let websocket = null;
    let state = 'idle';
    let aiResponseEl = null;
    let currentAiResponseText = ""; // To accumulate AI response text for Markdown parsing

    let mediaRecorderAudioContext = null;
    let mediaStreamSource = null;
    let audioWorkletNode = null;
    let audioBuffer = [];

    const SAMPLE_RATE = 44100;
    let audioContext = null;
    let audioQueue = [];
    let isPlaying = false;
    let playheadTime = 0;
    let isWavHeaderReceived = false;

    const setState = (newState) => {
        state = newState;
        updateUI();
    };

    const updateUI = () => {
        recordBtn.dataset.state = state;
        recordBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700', 'pulse-ring', 'bg-red-600', 'hover:bg-red-700', 'bg-gray-400', 'cursor-not-allowed');

        // Disable persona selector when not idle
        personaSelectEl.disabled = state !== 'idle';

        switch (state) {
            case 'idle':
                statusEl.textContent = "Click to start recording";
                recordBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
                recordBtn.disabled = websocket?.readyState !== WebSocket.OPEN;
                break;
            case 'connecting':
                statusEl.textContent = "Connecting...";
                recordBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
                recordBtn.disabled = true;
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

    function bufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    const initializeWebSocket = () => {
        console.log("Initializing WebSocket...");
        setState('connecting');
        websocket = new WebSocket(`ws://${window.location.host}/ws`);

        websocket.onopen = () => {
            console.log("WebSocket.onopen event fired. Connection successful.");
            setState('idle');
        };

        websocket.onerror = (e) => {
            console.error("WebSocket.onerror event fired:", e);
            showNotification("Connection error. Please refresh.", "error");
            setState('idle');
        };

        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'transcript':
                    displayInterimTranscript(message.data);
                    break;
                case 'user_transcript':
                    displayFinalTranscript(message.data);
                    break;
                case 'llm_chunk':
                    handleLlmChunk(message.data);
                    break;
                case 'llm_end':
                    handleLlmEnd();
                    break;
                case 'audio':
                    playAudioChunk(message.data);
                    break;
                case 'error':
                    showNotification(message.detail, 'error');
                    setState('idle');
                    break;
            }
        };

        websocket.onclose = () => {
            console.log("WebSocket.onclose event fired.");
            setState('idle');
            recordBtn.disabled = true;
            statusEl.textContent = "Connection lost. Please refresh.";
            showNotification("Connection lost. Please refresh the page.", "error");
        };
    };

    const startRecording = async () => {
        if (state !== 'idle' || !websocket || websocket.readyState !== WebSocket.OPEN) return;

        // Reset audio playback states
        audioQueue = [];
        isPlaying = false;
        playheadTime = 0;
        isWavHeaderReceived = false;
        if (audioContext) {
            await audioContext.close();
            audioContext = null;
        }

        // Send config to start a new transcription session
        websocket.send(JSON.stringify({
            type: "config",
            session_id: window.chatSessionId,
            sample_rate: 16000,
            persona: personaSelectEl.value
        }));

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setState('recording'); // Move setState here so UI changes after mic access

            mediaRecorderAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            await mediaRecorderAudioContext.audioWorklet.addModule('/static/audio-processor.js');

            mediaStreamSource = mediaRecorderAudioContext.createMediaStreamSource(stream);
            audioWorkletNode = new AudioWorkletNode(mediaRecorderAudioContext, 'audio-data-processor');

            audioWorkletNode.port.onmessage = (event) => {
                if (state !== 'recording') return;
                const pcmData = new Float32Array(event.data);
                audioBuffer.push(pcmData);
                if (audioBuffer.length >= 10) {
                    sendBufferedAudio();
                }
            };
            mediaStreamSource.connect(audioWorkletNode);

        } catch (err) {
            console.error("Microphone error", err);
            showNotification("Microphone access denied. Please allow microphone access.", "error");
            setState('idle');
        }
    };

    const sendBufferedAudio = () => {
        if (audioBuffer.length === 0 || !websocket || websocket.readyState !== WebSocket.OPEN) return;

        const totalLength = audioBuffer.reduce((acc, val) => acc + val.length, 0);
        const concatenated = new Float32Array(totalLength);
        let offset = 0;
        for (const buffer of audioBuffer) {
            concatenated.set(buffer, offset);
            offset += buffer.length;
        }

        const int16Pcm = new Int16Array(concatenated.length);
        for (let i = 0; i < concatenated.length; i++) {
            int16Pcm[i] = Math.max(-1, Math.min(1, concatenated[i])) * 32767;
        }

        websocket.send(JSON.stringify({
            type: "audio",
            data: bufferToBase64(int16Pcm.buffer)
        }));
        audioBuffer = [];
    };

    const stopRecording = () => {
        if (state !== 'recording') return;
        setState('processing');
        sendBufferedAudio();

        if (mediaStreamSource) {
            mediaStreamSource.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (mediaRecorderAudioContext) {
            mediaRecorderAudioContext.close().then(() => {
                mediaRecorderAudioContext = null;
                mediaStreamSource = null;
                audioWorkletNode = null;
            });
        }

        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: "stop_recording" }));
        }
    };

    const displayInterimTranscript = (text) => {
        let el = document.getElementById('interim-transcript');
        if (!el) {
            el = document.createElement('div');
            el.id = 'interim-transcript';
            el.className = 'p-4 bg-gray-100 dark:bg-gray-700 rounded-lg mb-4 opacity-60';
            conversationEl.appendChild(el);
        }
        el.textContent = text;
        conversationEl.scrollTop = conversationEl.scrollHeight;
    };

    const displayFinalTranscript = (text) => {
        let interimEl = document.getElementById('interim-transcript');
        if (interimEl) interimEl.remove();

        const el = document.createElement('div');
        el.className = 'p-4 bg-gray-200 dark:bg-gray-800 rounded-lg mb-4 text-right';
        el.innerHTML = `<strong class="font-semibold block text-blue-600 dark:text-blue-400">You</strong>${text}`;
        conversationEl.appendChild(el);
        conversationEl.scrollTop = conversationEl.scrollHeight;
    };

    const handleLlmChunk = (text) => {
        if (!aiResponseEl) {
            currentAiResponseText = ""; // Reset for new response
            aiResponseEl = document.createElement('div');
            // Add a class for styling markdown content
            aiResponseEl.className = 'p-4 bg-blue-50 dark:bg-blue-900/50 rounded-lg mb-4 prose dark:prose-invert max-w-none';
            const strong = document.createElement('strong');
            strong.className = 'font-semibold block text-green-600 dark:text-green-400';
            strong.textContent = 'AI Agent';
            aiResponseEl.appendChild(strong);
            const contentSpan = document.createElement('span');
            aiResponseEl.appendChild(contentSpan);
            conversationEl.appendChild(aiResponseEl);
        }
        currentAiResponseText += text;
        // Use innerHTML with marked.parse to render Markdown
        aiResponseEl.querySelector('span').innerHTML = marked.parse(currentAiResponseText);
        conversationEl.scrollTop = conversationEl.scrollHeight;
    };

    const handleLlmEnd = () => {
        aiResponseEl = null;
        currentAiResponseText = ""; // Clear the accumulator
        setState('idle');
    };

    function base64ToPCMFloat32(base64) {
        try {
            const binary = atob(base64);
            const offset = !isWavHeaderReceived ? 44 : 0;
            if (!isWavHeaderReceived) isWavHeaderReceived = true;
            if (binary.length <= offset) return new Float32Array(0);
            const buffer = new ArrayBuffer(binary.length - offset);
            const view = new DataView(buffer);
            for (let i = 0; i < view.byteLength; i++) {
                view.setUint8(i, binary.charCodeAt(i + offset));
            }
            const pcm16 = new Int16Array(buffer);
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 32768.0;
            }
            return float32;
        } catch (e) {
            console.error("Error decoding base64 audio:", e);
            return new Float32Array(0);
        }
    }

    function processAndPlay() {
        if (audioQueue.length === 0 || !isPlaying) {
            isPlaying = false;
            return;
        }
        const float32Array = audioQueue.shift();
        if (!float32Array || float32Array.length === 0) {
            processAndPlay();
            return;
        }
        const buffer = audioContext.createBuffer(1, float32Array.length, SAMPLE_RATE);
        buffer.copyToChannel(float32Array, 0);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        const now = audioContext.currentTime;
        const startTime = Math.max(now, playheadTime);
        source.start(startTime);
        playheadTime = startTime + buffer.duration;
        source.onended = processAndPlay;
    }

    function playAudioChunk(base64Audio) {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
            playheadTime = audioContext.currentTime;
        }
        const pcmData = base64ToPCMFloat32(base64Audio);
        if (pcmData.length > 0) {
            audioQueue.push(pcmData);
            if (!isPlaying) {
                isPlaying = true;
                if (audioContext.state === 'suspended') {
                    audioContext.resume().then(processAndPlay);
                } else {
                    processAndPlay();
                }
            }
        }
    }

    recordBtn.addEventListener('click', () => {
        if (state === 'idle') startRecording();
        else if (state === 'recording') stopRecording();
    });

    // Add event listener for persona changes
    personaSelectEl.addEventListener('change', () => {
        // Changing persona starts a new chat session with the new persona
        const newPersona = personaSelectEl.value;
        window.location.href = `${window.location.pathname}?persona=${newPersona}`;
    });

    initializeWebSocket();
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