# AI Voice Agent

This project is a conversational AI voice agent that listens to your questions and responds in a natural voice. It's a web-based application with a simple and intuitive interface, allowing users to have voice-based conversations with a powerful AI.

## 📸 Screenshots



*A screenshot of the main interface:*
![AI Voice Agent Interface]( https://res.cloudinary.com/backend-tube/image/upload/v1755154372/Screenshot_2025-08-13_124951_zmw2xn.png )

## ✨ Features

This AI agent is more than just a chatbot. It comes packed with advanced features to provide a rich, interactive, and highly customizable conversational experience.

*   **Real-time Streaming Conversation:** Experience a natural, low-latency conversation. The agent processes your speech in real-time, and both the AI's text response and synthesized voice are streamed back to the client as they are generated.

*   **Dynamic AI Personas:** Tailor the AI's personality to your preference. Choose from a dropdown menu of predefined personas (e.g., "Default," "Sarcastic Assistant") to change the AI's conversational style.

*   **Integrated AI Tools (Function Calling):** The agent can access external tools to answer questions about real-world, real-time information. If you ask a question that requires current information, the AI will automatically decide to use one of the following tools:
    *   **🌐 Web Search:** Ask about current events, news, or any topic on the internet. The agent uses the Tavily API to perform a web search and provide a summarized, up-to-date answer. This requires a `TAVILY_API_KEY`.
    *   **☀️ Current Weather:** Get the current weather conditions for any city. The agent can fetch real-time weather data (like temperature and conditions) for any location you specify.

*   **Client-Side API Key Management:** A secure and flexible way to manage API credentials. You can enter your own API keys for AssemblyAI, Google Gemini, Murf, and Tavily directly into a settings modal in the browser. These keys are stored locally in your browser and are used for the duration of your session, providing enhanced privacy and control.

*   **Comprehensive Session Management:** Your conversation history is maintained throughout a browser session. You can start a new chat at any time, and your session is identified by a unique ID in the URL.

*   **Health & Usage Monitoring:** The backend provides API endpoints (`/health` and `/usage`) to monitor the application's status and track estimated API credit usage.

*   **Modern, Responsive Interface:** The UI is built with Tailwind CSS for a clean look and is fully responsive, working seamlessly on both desktop and mobile browsers.

## 🛠️ Technologies Used

### Backend

*   **[FastAPI](https://fastapi.tiangolo.com/):** A modern, fast (high-performance) web framework for building APIs with Python.
*   **[Uvicorn](https://www.uvicorn.org/):** A lightning-fast ASGI server, used to run the FastAPI application.
*   **[AssemblyAI](https://www.assemblyai.com/):** Used for highly accurate speech-to-text transcription.
*   **[Google Gemini](https://deepmind.google/technologies/gemini/):** The generative AI model (`gemini-1.5-flash`) used for generating intelligent responses.
*   **[Murf AI](https://murf.ai/):** Used for converting the AI's text response back into natural-sounding speech via WebSocket streaming.

### Frontend

*   **HTML5, CSS3, JavaScript:** The standard technologies for building the web interface.
*   **[Tailwind CSS](https://tailwindcss.com/):** A utility-first CSS framework for rapid UI development.
*   **MediaRecorder API:** A browser API used to record audio from the user's microphone.
*   **Web Audio API:** Used to play the incoming audio stream from the AI in real-time, providing a seamless playback experience.

## 📂 Project Structure

Here is an overview of the key files and directories in the project:

| File/Directory | Description |
| :--- | :--- |
| `main.py` | The core **FastAPI** backend server. It handles WebSocket connections, manages conversation sessions, integrates with AI services (Gemini, Murf), and orchestrates the entire application flow. |
| `transcriber.py` | Contains the `AssemblyAIStreamingTranscriber` class, a dedicated module to handle real-time speech-to-text using the AssemblyAI service. |
| `persona.py` | Defines the different AI **personas** (e.g., "default," "sarcastic") that can be selected in the UI to change the AI's personality. |
| `get_current_weather_tool.py` | Implements the **function calling** tool for fetching the current weather. |
| `web_search_tool.py` | Implements the **function calling** tool for performing web searches using the Tavily API. |
| `gemini_search_tool_eg.py` | A standalone **example script** demonstrating how to use Google's native search tool with Gemini. It is not used in the main application but serves as a helpful reference. |
| `requirements.txt` | Lists all the Python dependencies for the project. |
| `static/` | A directory containing all frontend assets. |
| `static/index.html` | The main HTML file for the user interface. |
| `static/app.js` | The core frontend JavaScript file. It manages the UI state, handles user interactions (recording, settings), and communicates with the backend via WebSockets. |
| `static/audio-processor.js` | An **AudioWorklet** processor that runs in a separate thread to capture and buffer audio from the microphone efficiently, preventing UI freezes. |

## ⚙️ How it Works

The application orchestrates a sophisticated, real-time pipeline between the browser, the backend server, and multiple AI services. Here is the detailed, step-by-step workflow:

1.  **Initiation & Configuration:**
    *   When you click the "Record" button, the frontend sends a `config` message to the backend over a WebSocket. This message includes the current `session_id`, the selected AI `persona`, and any client-side API keys you've provided.

2.  **Efficient Audio Capture:**
    *   The browser uses the modern **`AudioWorklet` API** to capture microphone audio. This runs in a separate thread, preventing UI lag.
    *   The worklet buffers the raw audio into larger chunks suitable for the transcription service and sends them to the backend.

3.  **Real-time Transcription:**
    *   The backend receives the audio chunks and streams them to **AssemblyAI** for transcription.
    *   As AssemblyAI generates transcripts, it sends back two types of events:
        *   **Interim results:** These are sent immediately to the UI for you to see what the AI is "hearing" in real-time.
        *   **Final transcript:** Once you stop talking, a final, more accurate transcript is generated.

4.  **LLM Processing & Tool Use (Function Calling):**
    *   The final transcript is sent to the **Google Gemini** model. To determine if an external tool is needed, the application follows a two-step process:
    *   **Step 1: Tool Check.** The backend first sends a non-streaming request to the model with the list of available tools (`get_current_weather` and `web_search`). The model analyzes the user's query and, if it decides a tool is necessary, it returns a *function call* request (e.g., `get_current_weather(city="Boston")`) instead of a text response.
    *   **Step 2: Tool Execution & Final Response.**
        *   **If a tool is requested:** The backend executes the corresponding Python function (e.g., calling the weather API). The result from the tool is then sent back to the Gemini model in a second request. The model uses this new, real-world information to generate a final, informed answer, which is then streamed to the user.
        *   **If no tool is needed:** If the model's initial response does not contain a function call, the application proceeds directly to stream the text-based answer to the user.

5.  **Dual Streaming Response (Text & Audio):**
    *   The final response from Gemini is received as a stream of text chunks.
    *   For each chunk, the backend performs two actions in parallel:
        *   It sends the text chunk to the browser to be displayed in the chat window immediately.
        *   It sends the text chunk to **Murf AI**'s WebSocket for real-time Text-to-Speech (TTS) conversion.

6.  **Real-time Audio Playback:**
    *   Murf AI streams the synthesized voice back to the backend as audio chunks.
    *   The backend immediately forwards these audio chunks to the browser.
    *   The browser uses the **Web Audio API** to queue and play these audio chunks as they arrive, resulting in a seamless and low-latency playback of the AI's voice.

## 🚀 Getting Started

Follow these instructions to set up and run the project locally.

### 1. Prerequisites

*   Python 3.7+
*   An IDE or text editor (e.g., VS Code).
*   API keys for the following services. Note that the web search tool requires a Tavily API key.
    *   **AssemblyAI** (Speech-to-Text)
    *   **Google AI** (for Gemini LLM)
    *   **Murf AI** (Text-to-Speech)
    *   **Tavily AI** (for Web Search tool)

### 2. Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/UtkarshKm/ai-voice-agent.git
    cd ai-voice-agent
    ```

2.  **Create and activate a virtual environment:**
    ```bash
    # For Windows
    python -m venv venv
    venv\Scripts\activate

    # For macOS/Linux
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

### 3. Configuration

This application provides two ways to configure your API keys. Client-side keys always take precedence over server-side keys.

#### Method 1: Server-Side (Recommended for Development)

You can provide API keys by creating a `.env` file in the root of the project. This is useful for local development if you are the only user.

1.  Create a file named `.env`.
2.  Add your API keys to it. This is also where you provide the key for the web search tool.

    ```env
    ASSEMBLYAI_API_KEY="your_assemblyai_api_key"
    GOOGLE_GENAI_API_KEY="your_google_genai_api_key"
    MURF_API_KEY="your_murf_api_key"
    TAVILY_API_KEY="your_tavily_api_key"
    ```

#### Method 2: Client-Side (Recommended for Multiple Users)

The application includes a user-friendly settings modal that allows you to enter API keys directly in the browser.

1.  Click the **Settings** (⚙️) button in the top-right corner of the UI.
2.  Enter your API keys for AssemblyAI, Gemini, Murf, and/or Tavily.
3.  Click **Save**.

The keys are stored securely in your browser's `localStorage` and will be used for all subsequent requests in your session. **This method overrides any keys set in the `.env` file on the server.**

### 4. Running the Application

1.  **Start the server:**
    ```bash
    uvicorn main:app --reload
    ```

2.  **Open your browser:**
    Navigate to [http://127.0.0.1:8000](http://127.0.0.1:8000).

You should now be able to interact with the AI Voice Agent.

## 🌐 API Reference

The application exposes both standard HTTP endpoints for status checks and a powerful WebSocket endpoint for real-time communication.

### HTTP Endpoints

The FastAPI backend provides the following RESTful endpoints:

*   `GET /`: Serves the main `index.html` page.
*   `GET /health`: A health check endpoint. Returns the application status, number of active sessions, and current credit usage estimates.
*   `GET /usage`: An endpoint to get the total estimated cost and processed audio seconds.
*   `GET /static/{path}`: Serves static files (CSS, JavaScript, etc.).

### WebSocket Endpoint

This is the core of the application, used for the entire real-time conversational pipeline.

*   **Endpoint**: `ws://<your-host>/ws`

Communication is handled via JSON messages, each with a `type` field that defines its purpose.

#### Client-to-Server Messages

| `type` | Payload Fields | Description |
| :--- | :--- | :--- |
| **`config`** | `session_id` (str), `persona` (str), `sample_rate` (int), `api_keys` (object) | **Required first message.** Configures the session. `api_keys` is an object with optional keys: `assemblyai`, `gemini`, `murf`, `tavily`. |
| **`audio`** | `data` (str) | Sends a base64-encoded PCM audio chunk to be transcribed. |
| **`stop_recording`** | (none) | Signals to the server that the user has finished recording audio and the final transcript should be processed. |

#### Server-to-Client Messages

| `type` | Payload Fields | Description |
| :--- | :--- | :--- |
| **`transcript`** | `data` (str) | An *interim* transcription result from the STT service for real-time UI display. |
| **`user_transcript`** | `data` (str) | The *final*, formatted user transcript after the user stops speaking. |
| **`llm_chunk`** | `data` (str) | A chunk of the AI's text response as it's being generated by the LLM. |
| **`llm_end`** | (none) | Signals that the full AI text response has been sent and the `llm_chunk` stream is complete. |
| **`audio`** | `data` (str) | A base64-encoded audio chunk of the AI's synthesized voice from the TTS service. |
| **`error`** | `detail` (str) | Reports a user-facing error that occurred on the server (e.g., "API key not configured"). |

## 🤔 Troubleshooting

Here are some common issues and their solutions:

| Problem | Solution(s) |
| :--- | :--- |
| **Microphone Access Denied** | When you first click "Record", your browser will ask for permission to use your microphone. Ensure you click **"Allow"**. If you accidentally blocked it, you must go into your browser's site settings for `127.0.0.1:8000` to change the permission. |
| **Connection Error / WebSocket Disconnected** | This usually means the backend server isn't running or is unreachable. <br> 1. Make sure you have the `uvicorn` server running in your terminal. <br> 2. Check for any error messages in the server terminal log. <br> 3. Ensure your browser can connect to the server's address (`http://127.0.0.1:8000`). |
| **API Key Not Configured Error** | You will see a notification if a required API key is missing. <br> 1. Use the **Settings (⚙️)** modal in the UI to add your keys. This is the easiest method. <br> 2. Alternatively, ensure your `.env` file is correctly named and located in the project root, and that the variable names are correct (e.g., `GOOGLE_GENAI_API_KEY`). |
| **AI Tools Fail (Weather/Search)** | The web search and weather tools require a `TAVILY_API_KEY`. If these tools aren't working, make sure you have provided this specific key via the Settings modal or your `.env` file. |
| **No Audio Output** | Check that your computer's volume is on and not muted. Also, check the browser's console (`F12` or `Cmd+Opt+J`) for any errors related to the Web Audio API, which might indicate a problem with audio playback. |

## 🙏 Acknowledgements

*   This project was created by **Utkarsh Kumawat**.
*   Special thanks to the providers of the AI services that power this application.
