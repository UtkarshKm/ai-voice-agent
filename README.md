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

## How it Works

The application uses a combination of real-time speech-to-text, a generative AI model, and a text-to-speech service to create a seamless conversational experience. Here is the step-by-step flow:

1.  **Real-time Transcription:**
    *   When you click the "Record" button, your browser captures your microphone audio and sends it to the backend over a WebSocket connection.
    *   The backend forwards the audio stream to **AssemblyAI**, which performs real-time transcription.
    *   The transcribed text is sent back to the browser in chunks and displayed on the screen for immediate feedback.

2.  **Sending the Final Transcript:**
    *   While the real-time transcription is happening, the browser accumulates the full transcript.
    *   When you click the "Stop" button, the WebSocket connection is closed, and the final, complete transcript is sent to the backend's main conversational agent endpoint (`/agent/chat/{session_id}`).

3.  **Generating an AI Response and Streaming Audio:**
    *   The backend receives the transcript and sends it to the **Google Gemini** model to generate an intelligent response.
    *   Instead of waiting for the full response, the backend receives the LLM's response as a **stream of text chunks**.
    *   As each text chunk is received from Gemini, it is immediately forwarded to **Murf AI's WebSocket API** for real-time text-to-speech conversion.
    *   Murf streams back the audio as base64-encoded chunks, which are then printed to the backend console.

4.  **Displaying the Final Answer:**
    *   While the audio is being generated, the backend accumulates the full text from the LLM stream.
    *   Once the stream is complete, the backend sends a final JSON response to the browser containing only the LLM's full text response.
    *   The browser then displays this text in the chat window, completing the conversation loop.

## Key Changes (July 2024)

This application was recently updated to fix a critical bug in the application flow and to enhance the backend's functionality.

*   **Fixed Application Flow:** The frontend is now correctly connected to the backend agent. Previously, the real-time transcription was displayed but never sent to the LLM for a response. The frontend now captures the final transcript and sends it to the backend to be processed.

*   **Backend Refactoring:** The main conversational endpoint (`/agent/chat/{session_id}`) has been refactored. It now accepts a text transcript directly in a JSON payload, making it more efficient. The previous implementation required the backend to accept an audio file and perform its own redundant transcription.

*   **LLM Response Streaming:** The backend now streams the response from the Google Gemini API. As the response is being generated, the text chunks are printed to the server's console logs in real-time. This is useful for debugging and observing the AI's response generation.

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
*   `POST /agent/chat/{session_id}`: The main endpoint for handling voice chats. It now accepts a JSON body with a `transcript` field and returns the AI's response.
*   `GET /health`: A health check endpoint that returns the status of the application and current credit usage.
*   `GET /usage`: An endpoint to get the total estimated cost and processed audio seconds.
*   `GET /static/{path}`: Serves static files (CSS, JavaScript).
*   `WEBSOCKET /ws`: The endpoint for real-time transcription.

## 🙏 Acknowledgements

*   This project was created by **Utkarsh Kumawat**.
*   Special thanks to the providers of the AI services that power this application.
