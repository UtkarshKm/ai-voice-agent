from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import os
from dotenv import load_dotenv
import assemblyai as aai
import google.generativeai as genai
from datetime import datetime, timedelta
import threading
import time
import asyncio
import logging
import websockets
import json
from typing import AsyncGenerator
from contextlib import asynccontextmanager
from transcriber import AssemblyAIStreamingTranscriber

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize AssemblyAI
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")

# Configure Google GenAI
genai.configure(api_key=os.getenv("GOOGLE_GENAI_API_KEY"))

# Configuration constants
MAX_HISTORY_LENGTH = 50
MAX_FILE_SIZE = 5 * 1024 * 1024  # Reduced to 5MB to save credits
SESSION_CLEANUP_HOURS = 24
API_TIMEOUT_SECONDS = 30
MAX_AUDIO_DURATION = 60  # Maximum 60 seconds to prevent excessive costs
MIN_AUDIO_DURATION = 0.5  # Minimum 0.5 seconds to avoid empty audio

# In-memory datastore for chat histories
chat_histories = {}

# Credit tracking (optional - for monitoring)
credit_usage = {"total_seconds_processed": 0, "estimated_cost": 0.0}

# Lifespan context manager for startup/shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("AI Voice Agent started successfully")
    logger.info(f"Max file size: {MAX_FILE_SIZE} bytes")
    logger.info(f"Max audio duration: {MAX_AUDIO_DURATION} seconds")
    logger.info(f"API timeout: {API_TIMEOUT_SECONDS} seconds")
    
    # Start cleanup thread
    cleanup_thread = threading.Thread(target=cleanup_old_sessions, daemon=True)
    cleanup_thread.start()
    
    yield
    
    # Shutdown
    logger.info("AI Voice Agent shutting down")
    logger.info(f"Total audio processed: {credit_usage['total_seconds_processed']} seconds")
    logger.info(f"Estimated cost: ${credit_usage['estimated_cost']:.4f}")

# Create FastAPI app with lifespan
app = FastAPI(
    title="AI Voice Agent - Day 10 - Utkarsh Kumawat", 
    version="1.2.0",
    lifespan=lifespan
)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

class ChatRequest(BaseModel):
    transcript: str

async def generate_llm_response(history: list, timeout: int = API_TIMEOUT_SECONDS) -> AsyncGenerator[str, None]:
    """Generate LLM response as an async stream with timeout handling."""
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        async def internal_generator():
            logger.info("Starting LLM async stream generation...")
            # The API call is awaited and returns an async generator
            async for response in await model.generate_content_async(history, stream=True):
                if hasattr(response, 'text') and response.text:
                    logger.info(f"LLM chunk: {response.text}")
                    yield response.text
            logger.info("LLM async stream generation complete.")

        # Use asyncio.timeout to apply a timeout to the async generator
        async with asyncio.timeout(timeout):
            async for chunk in internal_generator():
                yield chunk

    except asyncio.TimeoutError:
        logger.error("LLM generation timeout")
        # Re-raise as HTTPException for the FastAPI framework to handle
        raise HTTPException(status_code=504, detail="LLM service timeout")
    except Exception as e:
        logger.error(f"LLM generation error: {e}")
        # Re-raise as HTTPException
        raise HTTPException(status_code=500, detail="LLM service failed")

async def stream_llm_to_murf(text_stream):
    """Streams text to Murf TTS WebSocket and prints base64 audio to console."""
    WS_URL = "wss://api.murf.ai/v1/speech/stream-input"
    API_KEY = os.getenv("MURF_API_KEY")
    CONTEXT_ID = "my_static_context_id_for_streaming"  # Using a static context ID

    if not API_KEY:
        logger.error("MURF_API_KEY environment variable not set.")
        return ""

    uri = f"{WS_URL}?api-key={API_KEY}&sample_rate=44100&channel_type=MONO&format=WAV"
    logger.info("Connecting to Murf WebSocket...")
    full_text = ""

    try:
        async with websockets.connect(uri) as ws:
            logger.info("Murf WebSocket connected.")
            # 1. Send voice configuration
            voice_config_msg = {
                "context_id": CONTEXT_ID,
                "voice_config": {
                    "voiceId": "en-US-amara",
                    "style": "Conversational",
                }
            }
            await ws.send(json.dumps(voice_config_msg))
            logger.info("Sent voice config to Murf.")

            # 2. Create a task to receive audio data
            async def receiver(websocket):
                while True:
                    try:
                        response = await websocket.recv()
                        data = json.loads(response)
                        if "audio" in data and data["audio"]:
                            # As requested, print the base64 encoded audio to the console
                            # print(f"Received audio chunk (base64): {data['audio']}")
                            print(f"Received audio chunk (base64)")
                        if data.get("final", False):
                            logger.info("Received final audio packet from Murf.")
                            break
                    except websockets.exceptions.ConnectionClosed:
                        logger.warning("Murf WebSocket connection closed by server.")
                        break
                    except Exception as e:
                        logger.error(f"Error receiving from Murf: {e}")
                        break

            receiver_task = asyncio.create_task(receiver(ws))

            # 3. Send text chunks from the LLM stream
            async for chunk in text_stream:
                if chunk:
                    full_text += chunk
                    text_msg = {
                        "context_id": CONTEXT_ID,
                        "text": chunk
                    }
                    await ws.send(json.dumps(text_msg))
            logger.info("Finished sending LLM text stream to Murf.")

            # 4. Signal the end of the text stream
            end_msg = {
                "context_id": CONTEXT_ID,
                "end": True
            }
            await ws.send(json.dumps(end_msg))
            logger.info("Sent end-of-stream signal to Murf.")

            # 5. Wait for the receiver to finish processing all audio
            await receiver_task
            logger.info("Murf streaming finished.")

    except Exception as e:
        logger.error(f"Error during Murf WebSocket streaming: {e}")

    return full_text

def manage_conversation_history(history: list) -> list:
    """Manage conversation history length"""
    if len(history) > MAX_HISTORY_LENGTH:
        return history[-MAX_HISTORY_LENGTH:]
    return history

# Background cleanup task
def cleanup_old_sessions():
    """Periodically cleans up chat histories for inactive sessions."""
    while True:
        try:
            time.sleep(3600)  # Wait 1 hour
            
            now = datetime.now()
            inactive_threshold = timedelta(hours=SESSION_CLEANUP_HOURS)
            
            session_ids_to_check = list(chat_histories.keys())
            logger.info(f"Running cleanup task for {len(session_ids_to_check)} sessions...")
            
            cleaned_count = 0
            for session_id in session_ids_to_check:
                if session_id in chat_histories:
                    last_accessed = chat_histories[session_id]["last_accessed"]
                    if now - last_accessed > inactive_threshold:
                        logger.info(f"Cleaning up inactive session: {session_id}")
                        del chat_histories[session_id]
                        cleaned_count += 1
            
            logger.info(f"Cleanup finished. Removed {cleaned_count} inactive sessions.")
            logger.info(f"Credit usage - Total: {credit_usage['total_seconds_processed']:.1f}s, Cost: ${credit_usage['estimated_cost']:.4f}")
            
        except Exception as e:
            logger.error(f"Cleanup task error: {e}")

# Health check endpoint with credit info
@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "timestamp": datetime.now(),
        "active_sessions": len(chat_histories),
        "credit_usage": {
            "total_seconds": credit_usage["total_seconds_processed"],
            "estimated_cost": round(credit_usage["estimated_cost"], 4)
        }
    }

# Credit usage endpoint
@app.get("/usage")
async def get_usage():
    return {
        "total_seconds_processed": credit_usage["total_seconds_processed"],
        "estimated_cost": round(credit_usage["estimated_cost"], 4),
        "remaining_credits": max(50 - credit_usage["estimated_cost"], 0)  # Assuming $50 free credits
    }

# Serve homepage
@app.get("/", response_class=HTMLResponse)
async def get_home():
    try:
        with open("static/index.html", "r", encoding="utf-8") as file:
            return HTMLResponse(content=file.read())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Homepage not found")

@app.post("/agent/chat/{session_id}")
async def agent_chat(session_id: str, request: ChatRequest):
    """Handles conversational chat with an agent, maintaining history."""
    try:
        logger.info(f"Processing chat for session: {session_id}")
        
        # Validate session_id
        if not session_id or len(session_id) < 10:
            raise HTTPException(status_code=400, detail="Invalid session ID")
        
        user_text = request.transcript
        logger.info(f"Received transcript: '{user_text[:50]}{'...' if len(user_text) > 50 else ''}'")
        
        if not user_text.strip():
            return {
                "audio_url": None,
                "user_transcript": "",
                "llm_response_text": "I didn't hear anything clear. Please speak louder and try again.",
                "error": "no_speech_detected"
            }

        # Retrieve or create chat history
        session_data = chat_histories.get(session_id, {
            "history": [], 
            "last_accessed": datetime.now()
        })
        history = session_data["history"]

        # Add user's message to history
        history.append({"role": "user", "parts": [user_text]})
        history = manage_conversation_history(history)

        # Generate LLM response and stream to TTS
        llm_text = ""
        try:
            logger.info("Starting LLM and TTS streaming pipeline...")
            llm_stream = generate_llm_response(history)
            llm_text = await stream_llm_to_murf(llm_stream)

            if llm_text:
                logger.info(f"Full LLM response received: '{llm_text[:50]}{'...' if len(llm_text) > 50 else ''}'")
                history.append({"role": "model", "parts": [llm_text]})
            else:
                logger.warning("LLM response was empty after streaming.")
                # Handle case where LLM or Murf fails and returns empty
                llm_text = "I tried to respond, but encountered an issue. Please try again."
                history.append({"role": "model", "parts": [llm_text]})

        except HTTPException:
            # Re-raise HTTP exceptions from downstream services (LLM, etc.)
            raise
        except Exception as e:
            logger.error(f"Error in streaming pipeline: {e}")
            llm_text = f"I heard: '{user_text}'. An unexpected error occurred."
            # Pop the user message as the model failed to produce a valid response
            history.pop()

        # Update session data
        chat_histories[session_id] = {
            "history": history, 
            "last_accessed": datetime.now()
        }

        # The audio has been streamed to the console.
        # Return the final text response to the client.
        return {
            "audio_url": None, # No longer sending an audio URL
            "user_transcript": user_text, 
            "llm_response_text": llm_text,
            "usage": {
                "estimated_cost": round(credit_usage["estimated_cost"], 4),
                "total_seconds": credit_usage["total_seconds_processed"]
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in agent chat: {e}")
        raise HTTPException(status_code=500, detail=f"Agent chat failed: {str(e)}")
    
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected to WebSocket")
    
    transcriber = AssemblyAIStreamingTranscriber(websocket=websocket, sample_rate=16000)

    try:
        while True:
            data = await websocket.receive_bytes()
            transcriber.stream_audio(data)
    except WebSocketDisconnect:
        logger.info("Client disconnected.")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        transcriber.close()
        logger.info("Transcription resources closed.")