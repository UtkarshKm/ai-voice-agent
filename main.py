from fastapi import FastAPI, HTTPException, File, UploadFile, Request
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

# Helper functions
def estimate_audio_duration(audio_data: bytes) -> float:
    """Estimate audio duration from audio data"""
    try:
        # For WebM files, we'll estimate based on file size
        # Rough estimate: WebM audio is ~8-16 kbps
        estimated_duration = len(audio_data) / (12 * 1024)  # Conservative estimate
        return min(estimated_duration, MAX_AUDIO_DURATION)
    except:
        return 5.0  # Default conservative estimate

def is_audio_too_short(audio_data: bytes) -> bool:
    """Check if audio is too short to be meaningful"""
    # Very basic check - if file is smaller than ~500 bytes, likely too short
    return len(audio_data) < 500

async def validate_audio_file(file: UploadFile) -> bytes:
    """Validate and read audio file with enhanced validation"""
    if file.size and file.size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413, 
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / 1024 / 1024:.1f}MB to save credits"
        )
    
    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
            
        # Check if audio is too short
        if is_audio_too_short(content):
            raise HTTPException(
                status_code=400, 
                detail="Audio too short. Please record at least 1 second of audio."
            )
            
        # Estimate duration and warn if too long
        estimated_duration = estimate_audio_duration(content)
        if estimated_duration > MAX_AUDIO_DURATION:
            raise HTTPException(
                status_code=400,
                detail=f"Audio too long (est. {estimated_duration:.1f}s). Maximum: {MAX_AUDIO_DURATION}s to save credits."
            )
            
        logger.info(f"Audio validated: {len(content)} bytes, estimated {estimated_duration:.1f}s")
        return content
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File read error: {e}")
        raise HTTPException(status_code=400, detail="Failed to read uploaded file")

async def transcribe_with_timeout(audio_data: bytes, timeout: int = API_TIMEOUT_SECONDS) -> str:
    """Transcribe audio with timeout handling and credit tracking"""
    try:
        loop = asyncio.get_event_loop()
        
        def transcribe_sync():
            # Use nano model for fastest/cheapest transcription
            config = aai.TranscriptionConfig(
                speech_model=aai.SpeechModel.nano,  # Fastest, most cost-effective
                punctuate=True,
                format_text=True,
                # Disable expensive features to save credits
                speaker_labels=False,
                auto_chapters=False,
                sentiment_analysis=False,
                entity_detection=False,
                iab_categories=False,
                content_safety=False
            )
            transcriber = aai.Transcriber(config=config)
            
            logger.info("Starting transcription with cost-optimized settings...")
            transcript = transcriber.transcribe(audio_data)
            logger.info(f"Transcription completed with status: {transcript.status}")
            
            # Track credit usage
            if hasattr(transcript, 'audio_duration'):
                duration = transcript.audio_duration
                estimated_cost = (duration / 3600) * 0.27  # $0.27/hour
                credit_usage["total_seconds_processed"] += duration
                credit_usage["estimated_cost"] += estimated_cost
                logger.info(f"Audio duration: {duration:.2f}s, Est. cost: ${estimated_cost:.4f}")
            
            return transcript
        
        transcript = await asyncio.wait_for(
            loop.run_in_executor(None, transcribe_sync),
            timeout=timeout
        )
        
        if transcript.status == aai.TranscriptStatus.error:
            logger.error(f"Transcription error: {transcript.error}")
            raise HTTPException(status_code=500, detail=f"Transcription failed: {transcript.error}")
        
        return transcript.text or ""
    
    except asyncio.TimeoutError:
        logger.error("Transcription timeout")
        raise HTTPException(status_code=504, detail="Transcription service timeout")
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

async def generate_llm_response(history: list, timeout: int = API_TIMEOUT_SECONDS) -> str:
    """Generate LLM response with timeout handling"""
    try:
        loop = asyncio.get_event_loop()
        
        def generate_sync():
            model = genai.GenerativeModel('gemini-2.5-flash')
            response = model.generate_content(history)
            return response.text
        
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
        raise e

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
async def agent_chat(session_id: str, file: UploadFile = File(...)):
    """Handles conversational chat with an agent, maintaining history."""
    try:
        logger.info(f"Processing chat for session: {session_id}")
        
        # Validate session_id
        if not session_id or len(session_id) < 10:
            raise HTTPException(status_code=400, detail="Invalid session ID")
        
        # Enhanced audio validation to save credits
        audio_data = await validate_audio_file(file)
        
        # Transcribe with timeout and cost tracking
        logger.info("Starting transcription process...")
        user_text = await transcribe_with_timeout(audio_data)
        logger.info(f"Transcription result: '{user_text[:50]}{'...' if len(user_text) > 50 else ''}'")
        
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