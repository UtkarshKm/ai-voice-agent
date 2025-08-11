// --- Configuration ---
const CONFIG = {
    MAX_RECORDING_TIME: 30000, // 30 seconds
    AUTO_RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
    REQUEST_TIMEOUT: 35000, // 35 seconds (slightly more than backend timeout)
    DEBOUNCE_DELAY: 300
};

// --- Utility Functions ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function fetchWithRetry(url, options, retries = CONFIG.AUTO_RETRY_ATTEMPTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                return response;
            }
            
            // Handle specific HTTP status codes
            if (response.status === 429) {
                console.warn(`Rate limited, attempt ${i + 1}/${retries}`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
                continue;
            }
            
            if (response.status === 504) {
                console.warn(`Timeout error, attempt ${i + 1}/${retries}`);
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
                    continue;
                }
            }
            
            // For other errors, get the error message and throw
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
            
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('Request timeout - please try again');
            }
            
            if (i === retries - 1) {
                throw error;
            }
            
            console.warn(`Request failed, attempt ${i + 1}/${retries}:`, error.message);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
        }
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    // Remove existing notifications
    const existing = document.querySelectorAll('.notification');
    existing.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 max-w-sm transition-all duration-300 ${getNotificationClasses(type)}`;
    notification.innerHTML = `
        <div class="flex items-start gap-3">
            <span class="text-lg">${getNotificationIcon(type)}</span>
            <div class="flex-1">
                <p class="text-sm font-medium">${message}</p>
            </div>
            <button class="text-gray-400 hover:text-gray-600" onclick="this.parentElement.parentElement.remove()">
                <span class="sr-only">Close</span>
                ×
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after duration
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }
    }, duration);
}

function getNotificationClasses(type) {
    const classes = {
        info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
        success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200',
        warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200',
        error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200'
    };
    return classes[type] || classes.info;
}

function getNotificationIcon(type) {
    const icons = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
    };
    return icons[type] || icons.info;
}

// --- Session Management ---
(function() {
    let sessionId = new URLSearchParams(window.location.search).get("session");

    if (!sessionId) {
        sessionId = crypto.randomUUID();
        const newUrl = `${window.location.pathname}?session=${sessionId}${window.location.hash}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);
    }

    console.log(`Chat Session ID: ${sessionId}`);
    window.chatSessionId = sessionId;

    const sessionIdDisplay = document.getElementById("session-id-display");
    if (sessionIdDisplay) {
        sessionIdDisplay.textContent = sessionId.split('-')[0];
        sessionIdDisplay.parentElement.title = `Full Session ID: ${sessionId}`;
    }
})();

// --- Text-to-Speech Functionality ---
document.getElementById("tts-submit").addEventListener("click", debounce(async () => {
    const ttsText = document.getElementById("tts-text").value;
    const ttsStatus = document.getElementById("tts-status");
    const ttsAudio = document.getElementById("tts-audio");
    const ttsSubmit = document.getElementById("tts-submit");

    if (!ttsText.trim()) {
        ttsStatus.textContent = "Please enter text to convert.";
        showNotification("Please enter some text first", "warning");
        return;
    }

    if (ttsText.length > 5000) {
        ttsStatus.textContent = "Text too long. Maximum 5000 characters.";
        showNotification("Text is too long. Please shorten it.", "warning");
        return;
    }

    // UI feedback
    ttsSubmit.disabled = true;
    ttsSubmit.innerHTML = '🔄 Generating...';
    ttsStatus.textContent = "Generating audio...";
    ttsAudio.src = "";
    ttsAudio.pause();

    try {
        const response = await fetchWithRetry("/api/text-to-speech", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: ttsText }),
        });

        const data = await response.json();
        if (data.audio_url) {
            ttsAudio.src = data.audio_url;
            await ttsAudio.play();
            ttsStatus.textContent = "Audio generated and playing!";
            showNotification("Audio generated successfully!", "success");
        } else {
            ttsStatus.textContent = "Error: No audio URL received.";
            showNotification("Failed to generate audio", "error");
        }
    } catch (error) {
        console.error("Error generating audio:", error);
        ttsStatus.textContent = `Error: ${error.message}`;
        showNotification(`TTS Error: ${error.message}`, "error");
    } finally {
        ttsSubmit.disabled = false;
        ttsSubmit.innerHTML = '✨ Generate';
    }
}, CONFIG.DEBOUNCE_DELAY));

// --- Echo Bot Enhanced Setup ---
(function setupEchoBot() {
    const startBtn = document.getElementById("startRecBtn");
    const stopBtn = document.getElementById("stopRecBtn");
    const player = document.getElementById("echoPlayer");
    const statusEl = document.getElementById("echoStatus");

    if (!startBtn || !stopBtn || !player) {
        console.warn("Echo Bot UI not present; skipping initialization");
        return;
    }

    let mediaStream = null;
    let mediaRecorder = null;
    let chunks = [];
    let recordingTimeout = null;
    let recordingStart = 0;

    const updateStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg || "";
    };

    const setRecordingUI = (isRecording) => {
        startBtn.disabled = isRecording;
        stopBtn.disabled = !isRecording;
        
        startBtn.classList.toggle("opacity-50", isRecording);
        startBtn.classList.toggle("cursor-not-allowed", isRecording);
        stopBtn.classList.toggle("animate-pulse", isRecording);

        const container = document.getElementById("echo-bot-section");
        if (container) {
            container.classList.toggle("ring-2", isRecording);
            container.classList.toggle("ring-emerald-400/60", isRecording);
            container.classList.toggle("bg-emerald-50", isRecording);
            container.classList.toggle("dark:bg-emerald-900/10", isRecording);
        }
    };

    const cleanupMediaStream = () => {
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        if (recordingTimeout) {
            clearTimeout(recordingTimeout);
            recordingTimeout = null;
        }
    };

    // Check for MediaRecorder support
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        updateStatus("MediaRecorder API not supported in this browser.");
        startBtn.disabled = true;
        stopBtn.disabled = true;
        showNotification("Your browser doesn't support audio recording", "error");
        return;
    }

    startBtn.addEventListener("click", async () => {
        try {
            if (mediaRecorder?.state === "recording") {
                console.warn("Already recording, ignoring start request");
                return;
            }

            updateStatus("Requesting microphone access…");
            
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            mediaRecorder = new MediaRecorder(mediaStream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
                    ? 'audio/webm;codecs=opus' 
                    : 'audio/webm'
            });

            chunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data?.size > 0) {
                    chunks.push(e.data);
                }
            };

            mediaRecorder.onstart = () => {
                recordingStart = Date.now();
                setRecordingUI(true);
                updateStatus("Recording… 0.0s");
                
                // Auto-stop recording after max time
                recordingTimeout = setTimeout(() => {
                    if (mediaRecorder?.state === "recording") {
                        mediaRecorder.stop();
                        showNotification("Recording stopped automatically after 30 seconds", "info");
                    }
                }, CONFIG.MAX_RECORDING_TIME);

                // Update recording time
                const updateTimer = setInterval(() => {
                    if (mediaRecorder?.state !== "recording") {
                        clearInterval(updateTimer);
                        return;
                    }
                    const elapsed = Math.round((Date.now() - recordingStart) / 100) / 10;
                    updateStatus(`Recording… ${elapsed}s`);
                }, 200);
            };

            mediaRecorder.onerror = (e) => {
                console.error("MediaRecorder error:", e);
                updateStatus("Recording error. Check console for details.");
                setRecordingUI(false);
                cleanupMediaStream();
                showNotification("Recording failed", "error");
            };

            mediaRecorder.onstop = async () => {
                cleanupMediaStream();
                setRecordingUI(false);
                updateStatus("Recording stopped. Processing…");

                const mime = mediaRecorder.mimeType || "audio/webm";
                const blob = new Blob(chunks, { type: mime });
                chunks = [];

                await transcribeAndEcho(blob);
            };

            mediaRecorder.start();
            showNotification("Recording started", "info", 2000);

        } catch (err) {
            console.error("getUserMedia error:", err);
            updateStatus("Microphone access denied or unavailable.");
            setRecordingUI(false);
            cleanupMediaStream();
            
            if (err.name === 'NotAllowedError') {
                showNotification("Microphone access denied. Please allow microphone access and try again.", "error");
            } else {
                showNotification("Failed to access microphone", "error");
            }
        }
    });

    stopBtn.addEventListener("click", () => {
        if (mediaRecorder?.state === "recording") {
            mediaRecorder.stop();
            updateStatus("Stopping…");
            stopBtn.disabled = true;
        }
    });

    // Enhanced transcription and echo function
    window.transcribeAndEcho = async (blob) => {
        const statusEl = document.getElementById("echoStatus");
        const transcriptDisplay = document.getElementById("transcript-display");
        const player = document.getElementById("echoPlayer");

        const updateStatus = (msg) => {
            if (statusEl) statusEl.textContent = msg;
        };

        updateStatus("Transcribing and generating echo…");
        if (transcriptDisplay) {
            transcriptDisplay.textContent = "Processing...";
            transcriptDisplay.classList.remove("italic");
        }

        const formData = new FormData();
        formData.append("file", blob, "recording.webm");

        try {
            const response = await fetchWithRetry("/api/tts/echo", {
                method: "POST",
                body: formData,
            });

            const result = await response.json();

            // Display the transcript
            if (transcriptDisplay) {
                if (result.transcript && result.transcript !== "(No speech detected)") {
                    transcriptDisplay.textContent = result.transcript;
                    transcriptDisplay.classList.remove("italic");
                } else {
                    transcriptDisplay.textContent = "No speech detected in the recording";
                    transcriptDisplay.classList.add("italic");
                }
            }

            // Play the new audio from Murf
            if (result.audio_url) {
                player.src = result.audio_url;
                try {
                    await player.play();
                    updateStatus("Echo generated and playing.");
                    showNotification("Echo generated successfully!", "success");
                } catch (playError) {
                    console.warn("Auto-play failed:", playError);
                    updateStatus("Echo generated. Click play to listen.");
                    showNotification("Echo ready - click play to listen", "info");
                }
            } else {
                updateStatus("Echo generation failed or no speech detected.");
                showNotification("No speech detected", "warning");
            }

        } catch (error) {
            console.error("Echo error:", error);
            updateStatus("Echo error. Please try again.");
            if (transcriptDisplay) {
                transcriptDisplay.textContent = `Error: ${error.message}`;
                transcriptDisplay.classList.remove("italic");
            }
            showNotification(`Echo failed: ${error.message}`, "error");
        }
    };
})();

// --- LLM Voice Query Enhanced Setup ---
(function setupLlmQueryBot() {
    const startBtn = document.getElementById("llmStartRecBtn");
    const stopBtn = document.getElementById("llmStopRecBtn");
    const player = document.getElementById("llmPlayer");
    const statusEl = document.getElementById("llmStatus");
    const conversationEl = document.getElementById("llmConversation");

    if (!startBtn) {
        console.warn("LLM Query section not present");
        return;
    }

    let mediaStream = null;
    let mediaRecorder = null;
    let chunks = [];
    let recordingTimeout = null;
    let isWaitingForResponse = false;

    const updateStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg || "";
    };

    const setRecordingUI = (isRecording) => {
        startBtn.disabled = isRecording || isWaitingForResponse;
        stopBtn.disabled = !isRecording;
        
        startBtn.classList.toggle("opacity-50", isRecording || isWaitingForResponse);
        stopBtn.classList.toggle("animate-pulse", isRecording);

        const section = document.getElementById("llm-query-section");
        if (section) {
            section.classList.toggle("ring-2", isRecording);
            section.classList.toggle("ring-blue-400/60", isRecording);
            section.classList.toggle("bg-blue-50", isRecording);
            section.classList.toggle("dark:bg-blue-900/10", isRecording);
        }
    };

    const cleanupLlmMediaStream = () => {
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        if (recordingTimeout) {
            clearTimeout(recordingTimeout);
            recordingTimeout = null;
        }
    };

    // Auto-recording when AI finishes speaking
    if (player) {
        player.addEventListener('ended', () => {
            console.log("AI audio finished, starting recording automatically.");
            updateStatus("Listening for your reply...");
            
            const section = document.getElementById("llm-query-section");
            if (section) {
                section.classList.add("flash-recording-feedback");
                setTimeout(() => section.classList.remove("flash-recording-feedback"), 1000);
            }

            if (!startBtn.disabled) {
                setTimeout(() => startBtn.click(), 200);
            } else {
                console.warn("Could not start recording automatically as the button is disabled.");
            }
        });
    }

    const addConversationMessage = (content, isUser = false, isError = false) => {
        if (!conversationEl) return;

        const messageDiv = document.createElement("div");
        
        if (isError) {
            messageDiv.className = "p-3 bg-red-100 dark:bg-red-900/30 rounded-lg border border-red-300 dark:border-red-700 mt-2";
            messageDiv.innerHTML = `<strong class="text-red-800 dark:text-red-200">Error:</strong> <span class="text-red-700 dark:text-red-300">${content}</span>`;
        } else if (isUser) {
            messageDiv.className = "p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg mt-2";
            messageDiv.innerHTML = `<strong class="text-blue-800 dark:text-blue-200">You:</strong> <span class="text-gray-800 dark:text-gray-200">${content}</span>`;
        } else {
            messageDiv.className = "p-3 bg-green-100 dark:bg-green-900/30 rounded-lg mt-2";
            messageDiv.innerHTML = `<strong class="text-green-800 dark:text-green-200">AI:</strong> <span class="text-gray-800 dark:text-gray-200">${content}</span>`;
        }
        
        conversationEl.appendChild(messageDiv);
        conversationEl.scrollTop = conversationEl.scrollHeight;
    };

    const handleQuery = async (blob) => {
        isWaitingForResponse = true;
        setRecordingUI(false);
        updateStatus("Sending to agent…");

        const formData = new FormData();
        formData.append("file", blob, "recording.webm");

        try {
            const url = `/agent/chat/${window.chatSessionId}`;
            const response = await fetchWithRetry(url, {
                method: "POST",
                body: formData,
            });

            const result = await response.json();

            // Handle the specific "no speech detected" error from the backend
            if (result.error === "no_speech_detected") {
                const errorDiv = document.createElement("div");
                errorDiv.className = "p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg text-center italic mt-2";
                errorDiv.innerHTML = `<span class="text-yellow-800 dark:text-yellow-200">${result.llm_response_text}</span>`;
                conversationEl.appendChild(errorDiv);
                conversationEl.scrollTop = conversationEl.scrollHeight;
                updateStatus("No speech detected.");
                showNotification("No speech detected - please try again", "warning");
                return;
            }

            // Display conversation messages
            if (result.user_transcript) {
                addConversationMessage(result.user_transcript, true);
            }
            
            if (result.llm_response_text) {
                addConversationMessage(result.llm_response_text, false);
            }

            // Play AI response
            if (result.audio_url && player) {
                player.src = result.audio_url;
                try {
                    await player.play();
                    updateStatus("Playing AI response.");
                } catch (playError) {
                    console.warn("Auto-play failed:", playError);
                    updateStatus("AI response ready. Click play to listen.");
                    showNotification("AI response ready - click play to listen", "info");
                }
            } else {
                updateStatus("LLM processing complete.");
            }

            if (result.error) {
                console.warn("Server returned error:", result.error);
                updateStatus(`Warning: ${result.error}`);
                showNotification(`Warning: ${result.error}`, "warning");
            }

        } catch (error) {
            console.error("LLM Query error:", error);
            updateStatus(`Error: ${error.message}`);
            addConversationMessage(error.message, false, true);
            showNotification(`Chat Error: ${error.message}`, "error");
        } finally {
            isWaitingForResponse = false;
            setRecordingUI(false);
        }
    };

    startBtn.addEventListener("click", async () => {
        try {
            if (mediaRecorder?.state === "recording") {
                console.warn("Already recording, ignoring start request");
                return;
            }

            updateStatus("Requesting microphone access…");
            
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            mediaRecorder = new MediaRecorder(mediaStream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
                    ? 'audio/webm;codecs=opus' 
                    : 'audio/webm'
            });
            
            chunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data?.size > 0) {
                    chunks.push(e.data);
                }
            };

            mediaRecorder.onstart = () => {
                setRecordingUI(true);
                updateStatus("Listening…");
                
                let recordingStart = Date.now();
                
                // Auto-stop after max time
                recordingTimeout = setTimeout(() => {
                    if (mediaRecorder?.state === "recording") {
                        mediaRecorder.stop();
                        showNotification("Recording stopped automatically after 30 seconds", "info");
                    }
                }, CONFIG.MAX_RECORDING_TIME);

                // Update timer
                const timerInterval = setInterval(() => {
                    if (mediaRecorder?.state !== "recording") {
                        clearInterval(timerInterval);
                        return;
                    }
                    const elapsed = Math.round((Date.now() - recordingStart) / 100) / 10;
                    updateStatus(`Listening… ${elapsed}s`);
                }, 200);
            };

            mediaRecorder.onstop = async () => {
                cleanupLlmMediaStream();
                setRecordingUI(false);
                updateStatus("Processing…");
                
                const blob = new Blob(chunks, { type: "audio/webm" });
                chunks = [];
                
                await handleQuery(blob);
            };

            mediaRecorder.onerror = (e) => {
                console.error("MediaRecorder error:", e);
                updateStatus("Recording error. Check console for details.");
                setRecordingUI(false);
                cleanupLlmMediaStream();
                showNotification("Recording failed", "error");
            };

            mediaRecorder.start();

        } catch (err) {
            console.error("Mic access error:", err);
            updateStatus("Microphone access denied or unavailable.");
            setRecordingUI(false);
            cleanupLlmMediaStream();
            
            if (err.name === 'NotAllowedError') {
                showNotification("Microphone access denied. Please allow microphone access and try again.", "error");
            } else {
                showNotification("Failed to access microphone", "error");
            }
        }
    });

    stopBtn.addEventListener("click", () => {
        if (mediaRecorder?.state === "recording") {
            mediaRecorder.stop();
            updateStatus("Processing…");
            stopBtn.disabled = true;
        }
    });
})();

// --- Global Error Handlers ---
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showNotification('An unexpected error occurred', 'error');
});

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter to generate TTS
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const ttsSubmit = document.getElementById('tts-submit');
        if (ttsSubmit && !ttsSubmit.disabled) {
            ttsSubmit.click();
        }
    }
    
    // Escape to stop any recording
    if (e.key === 'Escape') {
        const stopButtons = ['stopRecBtn', 'llmStopRecBtn'];
        stopButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn && !btn.disabled) {
                btn.click();
            }
        });
    }
});

// --- Connection Status Monitoring ---
let isOnline = navigator.onLine;
const statusIndicator = document.querySelector('.inline-block.h-2.w-2.rounded-full');

function updateConnectionStatus() {
    isOnline = navigator.onLine;
    if (statusIndicator) {
        statusIndicator.className = `inline-block h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`;
    }
    
    if (!isOnline) {
        showNotification('You appear to be offline', 'warning');
    }
}

window.addEventListener('online', () => {
    updateConnectionStatus();
    showNotification('Connection restored', 'success', 3000);
});

window.addEventListener('offline', () => {
    updateConnectionStatus();
});

// Initialize connection status
updateConnectionStatus();