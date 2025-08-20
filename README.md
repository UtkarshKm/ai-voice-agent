# AI Voice Agent

This project is a conversational AI voice agent that listens to your questions and responds in a natural voice. It's a web-based application with a simple and intuitive interface, allowing users to have voice-based conversations with a powerful AI.

## 📸 Screenshots



*A screenshot of the main interface:*
![AI Voice Agent Interface]( https://res.cloudinary.com/backend-tube/image/upload/v1755154372/Screenshot_2025-08-13_124951_zmw2xn.png )

## ✨ Features

*   **Voice-based Interaction:** Speak to the AI in your natural voice.
*   **Real-time Conversation:** Get fast and relevant responses from the AI.
*   **Session Management:** The conversation history is maintained throughout a session.
*   **Cost Optimization:** Uses efficient AI models and techniques to minimize operational costs.
*   **Health & Usage Monitoring:** Endpoints to check the application's status and API credit usage.
*   **Responsive Design:** Works on both desktop and mobile browsers.

## 🛠️ Technologies Used

### Backend

*   **[FastAPI](https://fastapi.tiangolo.com/):** A modern, fast (high-performance) web framework for building APIs with Python.
*   **[Uvicorn](https://www.uvicorn.org/):** A lightning-fast ASGI server, used to run the FastAPI application.
*   **[AssemblyAI](https://www.assemblyai.com/):** Used for highly accurate speech-to-text transcription.
*   **[Google Gemini](https://deepmind.google/technologies/gemini/):** The generative AI model (`gemini-2.5-flash`) used for generating intelligent responses.
*   **[Murf AI](https://murf.ai/):** Used for converting the AI's text response back into natural-sounding speech.

### Frontend

*   **HTML5, CSS3, JavaScript:** The standard technologies for building the web interface.
*   **[Tailwind CSS](https://tailwindcss.com/):** A utility-first CSS framework for rapid UI development.
*   **MediaRecorder API:** A browser API used to record audio from the user's microphone.

## 🏗️ Architecture

The application follows a client-server architecture:

1.  **Client (Frontend):** A static single-page application built with HTML, Tailwind CSS, and JavaScript. It captures audio from the user's microphone, sends it to the backend, and plays the AI's audio response.
2.  **Server (Backend):** A FastAPI application that orchestrates the AI services:
    *   It receives the audio data from the client.
    *   It sends the audio to **AssemblyAI** for transcription.
    *   It takes the transcribed text and sends it to the **Google Gemini** model, along with the conversation history, to generate a response.
    *   It sends the AI's text response to **Murf AI** to generate a spoken version of the response.
    *   It returns the URL of the generated audio and the text of the conversation to the client.

Session management is handled by passing a unique `session_id` from the client with each request. The server stores the conversation history for each session in memory.

## 🚀 Getting Started

Follow these instructions to set up and run the project locally.

### 1. Prerequisites

*   Python 3.7+
*   An IDE or text editor of your choice (e.g., VS Code).
*   API keys for the following services:
    *   AssemblyAI
    *   Google AI (for Gemini)
    *   Murf AI

### 2. Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/UtkarshKm/ai-voice-agent.git
    cd ai-voice-agent
    ```

2.  **Create a virtual environment and activate it:**
    ```bash
    # For Windows
    python -m venv venv
    venv\Scripts\activate

    # For macOS/Linux
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  **Install the dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

### 3. Configuration

1.  Create a file named `.env` in the root of the project.
2.  Add your API keys to the `.env` file as follows:

    ```
    ASSEMBLYAI_API_KEY="your_assemblyai_api_key"
    GOOGLE_GENAI_API_KEY="your_google_genai_api_key"
    MURF_API_KEY="your_murf_api_key"
    ```

### 4. Running the Application

1.  **Start the server:**
    ```bash
    uvicorn main:app --reload
    ```

2.  **Open your browser:**
    Navigate to [http://127.0.0.1:8000](http://127.0.0.1:8000).

You should now be able to interact with the AI Voice Agent.

## 🌐 API Endpoints

The FastAPI backend provides the following endpoints:

*   `GET /`: Serves the main HTML page.
*   `POST /agent/chat/{session_id}`: The main endpoint for handling voice chats. It accepts an audio file and returns the AI's response.
*   `GET /health`: A health check endpoint that returns the status of the application and current credit usage.
*   `GET /usage`: An endpoint to get the total estimated cost and processed audio seconds.
*   `GET /static/{path}`: Serves static files (CSS, JavaScript).

---

## Turn Detection Feature

A key feature of this application is **real-time transcription with turn detection**, which allows the application to wait until a user has finished speaking before displaying the final, formatted transcript.

### How Turn Detection Works

The real-time transcription and turn detection feature is built around a WebSocket connection between the client (browser) and the server (FastAPI).

1.  **Audio Streaming from Client:**
    - The user clicks the "record" button in the browser.
    - The JavaScript in `static/app.js` captures microphone audio, encodes it into 16-bit PCM format, and sends it in chunks over a WebSocket to the `/ws` endpoint on the server.

2.  **Server-Side Transcription:**
    - The FastAPI server receives the audio chunks on the WebSocket.
    - In `main.py`, the `websocket_endpoint` passes the audio stream to an instance of `AssemblyAIStreamingTranscriber` (defined in `transcriber.py`).
    - The `transcriber` class establishes a connection with AssemblyAI's real-time transcription service and forwards the audio stream. For this to work, `format_turns=True` is enabled in the connection parameters.

3.  **Handling AssemblyAI Events:**
    - The `AssemblyAIStreamingTranscriber` listens for events from the AssemblyAI service. The most important one for this feature is the `TurnEvent`.
    - AssemblyAI sends multiple `TurnEvent` messages. When `format_turns` is enabled, it sends an initial unformatted transcript when the user stops talking, followed by a final, formatted transcript.
    - The `on_turn` event handler in `transcriber.py` contains logic to check for two conditions on the event object:
        - `event.end_of_turn` is `True`.
        - `event.turn_is_formatted` is `True`.
    - This ensures we only act on the final, formatted version of the transcript.

4.  **Sending Transcript to Client:**
    - When the final formatted transcript is received, the `on_turn` handler sends it back to the client over the same WebSocket connection. The message is a JSON object like: `{"type": "transcript", "data": "Hello. How are you?"}`.

5.  **Displaying on the UI:**
    - The `websocket.onmessage` handler in `static/app.js` listens for incoming messages.
    - If the message `type` is `transcript`, the JavaScript creates a new `div` element and displays the transcript text in the conversation area on the webpage.

### Key Files for Turn Detection

-   **`transcriber.py`**: Contains the `AssemblyAIStreamingTranscriber` class, which manages the connection to AssemblyAI and includes the event handlers (`on_turn`, `on_error`, etc.). This is where the core turn detection logic resides.
-   **`main.py`**: Sets up the FastAPI server and the `/ws` WebSocket endpoint. It orchestrates the flow of data from the client to the transcriber.
-   **`static/app.js`**: All client-side logic for recording audio, managing the WebSocket connection, and updating the UI with the final transcript.
-   **`static/index.html`**: The HTML structure of the application, including the container where transcripts are displayed.

## 🙏 Acknowledgements

*   This project was created by **Utkarsh Kumawat**.
*   Special thanks to the providers of the AI services that power this application.
