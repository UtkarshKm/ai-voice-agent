from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from murf import Murf
import os
from dotenv import load_dotenv
import assemblyai as aai
import google.generativeai as genai
from datetime import datetime, timedelta
import threading
import time
import asyncio
import logging
from typing import Optional
from contextlib import asynccontextmanager
import io
import wave
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

# Initialize Murf client
client = Murf(api_key=os.getenv("MURF_API_KEY"))

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

async def generate_llm_response(history: list, timeout: int = API_TIMEOUT_SECONDS) -> str:
    """Generate LLM response with timeout handling and streaming to console"""
    try:
        loop = asyncio.get_event_loop()
        
        def generate_sync():
            model = genai.GenerativeModel('gemini-1.5-flash')

            logger.info("Starting LLM stream generation...")
            responses = model.generate_content(history, stream=True)

            accumulated_response = ""
            for response in responses:
                if hasattr(response, 'text') and response.text:
                    logger.info(f"LLM chunk: {response.text}")
                    accumulated_response += response.text
            logger.info("LLM stream generation complete.")
            return accumulated_response

        llm_text = await asyncio.wait_for(
            loop.run_in_executor(None, generate_sync),
            timeout=timeout
        )
        
        return llm_text
    
    except asyncio.TimeoutError:
        logger.error("LLM generation timeout")
        raise HTTPException(status_code=504, detail="LLM service timeout")
    except Exception as e:
        logger.error(f"LLM generation error: {e}")
        # Ensure we don't expose internal errors to the client
        raise HTTPException(status_code=500, detail="LLM service failed")

async def generate_speech_with_timeout(text: str, voice_id: str = "en-US-ken", 
                                     style: str = "Conversational", 
                                     timeout: int = API_TIMEOUT_SECONDS) -> str:
    """Generate speech with timeout handling"""
    try:
        # Truncate text to save on TTS costs
        if len(text) > 2000:
            text = text[:1900] + "... (response truncated to save costs)"
            
        loop = asyncio.get_event_loop()
        
        def generate_speech_sync():
            response = client.text_to_speech.generate(
                text=text, voice_id=voice_id, style=style
            )
            return response.audio_file
        
        audio_url = await asyncio.wait_for(
            loop.run_in_executor(None, generate_speech_sync),
            timeout=timeout
        )
        
        return audio_url
    
    except asyncio.TimeoutError:
        logger.error("Speech generation timeout")
        raise HTTPException(status_code=504, detail="Speech generation service timeout")
    except Exception as e:
        logger.error(f"Speech generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {str(e)}")

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

        # Generate LLM response
        llm_text = ""
        try:
            logger.info("Generating LLM response...")
            llm_text = await generate_llm_response(history)
            logger.info(f"LLM response generated: '{llm_text[:50]}{'...' if len(llm_text) > 50 else ''}'")
            history.append({"role": "model", "parts": [llm_text]})
        except Exception as genai_error:
            logger.error(f"GenAI Error: {genai_error}")
            llm_text = f"I heard: '{user_text}'. The AI service is temporarily unavailable."
            history.pop()  # Remove user message if LLM fails

        # Update session data
        chat_histories[session_id] = {
            "history": history, 
            "last_accessed": datetime.now()
        }

        # Generate speech
        audio_url = None
        try:
            logger.info("Generating speech audio...")
            audio_url = await generate_speech_with_timeout(llm_text)
            logger.info("Speech audio generated successfully")
        except Exception as murf_error:
            logger.error(f"Speech generation failed: {murf_error}")
            return {
                "audio_url": None, 
                "user_transcript": user_text, 
                "llm_response_text": llm_text, 
                "error": "TTS generation failed"
            }

        return {
            "audio_url": audio_url, 
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