// --- Session Management ---
(function() {
    let sessionId = new URLSearchParams(window.location.search).get("session");

    if (!sessionId) {
        // Generate a new session ID using the browser's crypto API
        sessionId = crypto.randomUUID();

        // Update the URL in the browser's address bar without reloading the page
        const newUrl = `${window.location.pathname}?session=${sessionId}${window.location.hash}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);
    }

    console.log(`Chat Session ID: ${sessionId}`);

    // Make the session ID globally available for other parts of the app
    window.chatSessionId = sessionId;

    // Display the session ID in the footer
    const sessionIdDisplay = document.getElementById("session-id-display");
    if (sessionIdDisplay) {
        // Display a shortened version for aesthetics
        sessionIdDisplay.textContent = sessionId.split('-')[0];
        sessionIdDisplay.parentElement.title = `Full Session ID: ${sessionId}`;
    }
})();

// Text-to-Speech functionality
document.getElementById("tts-submit").addEventListener("click", async () => {
    const ttsText = document.getElementById("tts-text").value;
    const ttsStatus = document.getElementById("tts-status");
    const ttsAudio = document.getElementById("tts-audio");

    if (!ttsText.trim()) {
        ttsStatus.textContent = "Please enter text to convert.";
        return;
    }

    ttsStatus.textContent = "Generating audio...";
    ttsAudio.src = "";
    ttsAudio.pause();

    try {
        const response = await fetch("/api/text-to-speech", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: ttsText }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const data = await response.json();
        if (data.audio_url) {
            ttsAudio.src = data.audio_url;
            await ttsAudio.play();
            ttsStatus.textContent = "Audio generated and playing!";
        } else {
            ttsStatus.textContent = "Error: No audio URL received.";
        }
    } catch (error) {
        console.error("Error generating audio:", error);
        ttsStatus.textContent = `Error: ${error.message}`;
    }
});

/* Echo Bot: Enhanced MediaRecorder-based microphone capture and playback */
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
    let recordingTicker = null;
    let recordingStart = 0;

    const updateStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg || "";
    };

    const setRecordingUI = (isRecording) => {
        startBtn.disabled = isRecording;
        stopBtn.disabled = !isRecording;

        // Visual feedback
        startBtn.classList.toggle("opacity-50", isRecording);
        startBtn.classList.toggle("cursor-not-allowed", isRecording);
        stopBtn.classList.toggle("animate-pulse", isRecording);

        // Section background feedback
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
        if (recordingTicker) {
            clearInterval(recordingTicker);
            recordingTicker = null;
        }
    };

    // Check for MediaRecorder support
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        updateStatus("MediaRecorder API not supported in this browser.");
        startBtn.disabled = true;
        stopBtn.disabled = true;
        return;
    }

    startBtn.addEventListener("click", async () => {
        try {
            if (mediaRecorder?.state === "recording") {
                console.warn("Already recording, ignoring start request");
                return;
            }

            updateStatus("Requesting microphone access…");
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(mediaStream);

            chunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data?.size > 0) {
                    chunks.push(e.data);
                }
            };

            mediaRecorder.onstart = () => {
                recordingStart = Date.now();
                setRecordingUI(true);
                recordingTicker = setInterval(() => {
                    const elapsed = Math.round((Date.now() - recordingStart) / 100) / 10;
                    updateStatus(`Recording… ${elapsed}s`);
                }, 200);
            };

            mediaRecorder.onerror = (e) => {
                console.error("MediaRecorder error:", e);
                updateStatus("Recording error. Check console for details.");
                setRecordingUI(false);
                cleanupMediaStream();
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
        } catch (err) {
            console.error("getUserMedia error:", err);
            updateStatus("Microphone access denied or unavailable.");
            setRecordingUI(false);
            cleanupMediaStream();
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
            const response = await fetch("/api/tts/echo", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
            }

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
                } catch (playError) {
                    console.warn("Auto-play failed:", playError);
                    updateStatus("Echo generated. Click play to listen.");
                }
            } else {
                updateStatus("Echo generation failed or no speech detected.");
            }

        } catch (error) {
            console.error("Echo error:", error);
            updateStatus("Echo error. Check console for details.");
            if (transcriptDisplay) {
                transcriptDisplay.textContent = `Error: ${error.message}`;
                transcriptDisplay.classList.remove("italic");
            }
        }
    };
})();

/* LLM Voice Query: Enhanced recording and processing */
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
    let recordingTicker = null;

    const updateStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg || "";
    };

    const setRecordingUI = (isRecording) => {
        startBtn.disabled = isRecording;
        stopBtn.disabled = !isRecording;
        startBtn.classList.toggle("opacity-50", isRecording);
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
        if (recordingTicker) {
            clearInterval(recordingTicker);
            recordingTicker = null;
        }
    };

    // --- Auto-recording when AI finishes speaking ---
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

    const handleQuery = async (blob) => {
        updateStatus("Sending to agent…");

        const formData = new FormData();
        formData.append("file", blob, "recording.webm");

        try {
            const url = `/agent/chat/${window.chatSessionId}`;
            const response = await fetch(url, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }

            const result = await response.json();

            // Handle the specific "no speech detected" error from the backend
            if (result.error === "no_speech_detected") {
                const errorDiv = document.createElement("div");
                errorDiv.className = "p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg text-center italic";
                errorDiv.innerHTML = `<span class="text-yellow-800 dark:text-yellow-200">${result.llm_response_text}</span>`;
                conversationEl.appendChild(errorDiv);
                conversationEl.scrollTop = conversationEl.scrollHeight;
                updateStatus("No speech detected.");
                return; // Stop further processing
            }

            // Display conversation and scroll to bottom
            if (conversationEl) {
                if (result.user_transcript) {
                    const userDiv = document.createElement("div");
                    userDiv.className = "p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg";
                    userDiv.innerHTML = `<strong class="text-blue-800 dark:text-blue-200">You:</strong> <span class="text-gray-800 dark:text-gray-200">${result.user_transcript}</span>`;
                    conversationEl.appendChild(userDiv);
                    conversationEl.scrollTop = conversationEl.scrollHeight;
                }
                
                if (result.llm_response_text) {
                    const llmDiv = document.createElement("div");
                    llmDiv.className = "p-3 bg-green-100 dark:bg-green-900/30 rounded-lg mt-2";
                    llmDiv.innerHTML = `<strong class="text-green-800 dark:text-green-200">AI:</strong> <span class="text-gray-800 dark:text-gray-200">${result.llm_response_text}</span>`;
                    conversationEl.appendChild(llmDiv);
                    conversationEl.scrollTop = conversationEl.scrollHeight;
                }
            }

            if (result.audio_url && player) {
                player.src = result.audio_url;
                try {
                    await player.play();
                    updateStatus("Playing LLM response.");
                } catch (playError) {
                    console.warn("Auto-play failed:", playError);
                    updateStatus("LLM response ready. Click play to listen.");
                }
            } else {
                updateStatus("LLM processing complete.");
            }

            if (result.error) {
                console.warn("Server returned error:", result.error);
                updateStatus(`Warning: ${result.error}`);
            }

        } catch (error) {
            console.error("LLM Query error:", error);
            updateStatus(`Error: ${error.message}`);
            
            if (conversationEl) {
                const errorDiv = document.createElement("div");
                errorDiv.className = "p-3 bg-red-100 dark:bg-red-900/30 rounded-lg border border-red-300 dark:border-red-700";
                errorDiv.innerHTML = `<strong class="text-red-800 dark:text-red-200">Error:</strong> <span class="text-red-700 dark:text-red-300">${error.message}</span>`;
                conversationEl.appendChild(errorDiv);
                conversationEl.scrollTop = conversationEl.scrollHeight;
            }
        }
    };

    startBtn.addEventListener("click", async () => {
        try {
            if (mediaRecorder?.state === "recording") {
                console.warn("Already recording, ignoring start request");
                return;
            }

            updateStatus("Requesting microphone access…");
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(mediaStream);
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
                recordingTicker = setInterval(() => {
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
            };

            mediaRecorder.start();

        } catch (err) {
            console.error("Mic access error:", err);
            updateStatus("Microphone access denied or unavailable.");
            setRecordingUI(false);
            cleanupLlmMediaStream();
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

// Global error handler for unhandled promises
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter to generate TTS
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const ttsSubmit = document.getElementById('tts-submit');
        if (ttsSubmit && !ttsSubmit.disabled) {
            ttsSubmit.click();
        }
    }
});