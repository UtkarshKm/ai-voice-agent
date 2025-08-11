from fastapi import FastAPI, HTTPException, File, UploadFile
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

# Load environment variables
load_dotenv()

# Initialize AssemblyAI
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")

# Configure Google GenAI - ensure GOOGLE_GENAI_API_KEY is in your .env file
genai.configure(api_key=os.getenv("GOOGLE_GENAI_API_KEY"))

app = FastAPI(title="AI Voice Agent - Day 10 - Utkarsh Kumawat", version="1.1.0")

# In-memory datastore for chat histories (suitable for prototyping)
chat_histories = {}

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize Murf client
client = Murf(api_key=os.getenv("MURF_API_KEY"))

# Request model
class TTSRequest(BaseModel):
    text: str
    voice_id: str = "en-US-ken"
    style: str = "Conversational"

# Serve homepage
@app.get("/", response_class=HTMLResponse)
async def get_home():
    with open("static/index.html", "r", encoding="utf-8") as file:
        return HTMLResponse(content=file.read())

# TTS endpoint
@app.post("/api/text-to-speech")
async def generate_speech(request: TTSRequest):
    """
    Create a server endpoint that accepts text and returns audio URL
    """
    try:
        # Call Murf's TTS API using SDK
        response = client.text_to_speech.generate(
            text=request.text,
            voice_id=request.voice_id,
            style=request.style
        )
        
        # Return URL pointing to the generated audio file
        return {
            "audio_url": response.audio_file,
            "text": request.text,
            "voice_id": request.voice_id,
            "style": request.style
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")



@app.post("/api/tts/echo")
async def tts_echo(file: UploadFile = File(...)):
    """
    Transcribe audio, generate new audio with Murf, and return the audio URL.
    """
    try:
        # 1. Transcribe the uploaded audio file
        audio_data = await file.read()
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(audio_data)

        if transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {transcript.error}")

        transcribed_text = transcript.text
        if not transcribed_text or not transcribed_text.strip():
            # Return a successful response but with a note that no speech was generated
            return {
                "audio_url": None,
                "transcript": "(No speech detected)"
            }

        # 2. Generate new audio from the transcribed text using Murf
        murf_response = client.text_to_speech.generate(
            text=transcribed_text,
            voice_id="en-US-ken",  # Using a default voice
            style="Conversational"
        )

        # 3. Return the new audio URL and the transcript
        return {
            "audio_url": murf_response.audio_file,
            "transcript": transcribed_text
        }

    except Exception as e:
        # Catch any exception, including from Murf or AssemblyAI
        raise HTTPException(status_code=500, detail=f"Echo Bot failed: {str(e)}")

@app.post("/llm/query")
async def llm_query_from_audio(file: UploadFile = File(...)):
    """
    Accepts audio, transcribes it, sends it to an LLM, 
    and returns the LLM's response as synthesized audio. (Stateless)
    """
    try:
        audio_data = await file.read()
        transcriber = aai.Transcriber()
        user_transcript = transcriber.transcribe(audio_data)

        if user_transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {user_transcript.error}")

        user_text = user_transcript.text
        if not user_text or not user_text.strip():
            return {"audio_url": None, "user_transcript": "(No speech detected)", "llm_response_text": ""}

        prompt = f"Please provide a concise response, under 3000 characters. User query: '{user_text}'"
        
        try:
            model = genai.GenerativeModel('gemini-1.5-flash-latest')
            response = model.generate_content(prompt)
            llm_text = response.text
        except Exception as genai_error:
            print(f"GenAI Error: {genai_error}")
            llm_text = f"I heard you say: '{user_text}'. This is a test response as the LLM service is currently unavailable."

        if len(llm_text) > 3000:
            llm_text = llm_text[:2900] + "..."

        try:
            murf_response = client.text_to_speech.generate(
                text=llm_text, voice_id="en-US-ken", style="Conversational"
            )
            audio_url = murf_response.audio_file
        except Exception as murf_error:
            print(f"Murf TTS Error: {murf_error}")
            return {"audio_url": None, "user_transcript": user_text, "llm_response_text": llm_text, "error": "TTS generation failed"}

        return {"audio_url": audio_url, "user_transcript": user_text, "llm_response_text": llm_text}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Unexpected error in LLM query: {e}")
        raise HTTPException(status_code=500, detail=f"LLM query failed: {str(e)}")

# --- New Chat History Endpoint ---
@app.post("/agent/chat/{session_id}")
async def agent_chat(session_id: str, file: UploadFile = File(...)):
    """
    Handles conversational chat with an agent, maintaining history.
    """
    try:
        # 1. Transcribe user's audio
        audio_data = await file.read()
        transcriber = aai.Transcriber()
        user_transcript = transcriber.transcribe(audio_data)

        if user_transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {user_transcript.error}")

        user_text = user_transcript.text
        if not user_text or not user_text.strip():
            # Return a specific, structured error that the frontend can handle
            return {
                "audio_url": None,
                "user_transcript": "",
                "llm_response_text": "I didn't hear anything. Could you please speak again?",
                "error": "no_speech_detected"
            }

        # 2. Retrieve or create chat history, and update last accessed time
        session_data = chat_histories.get(session_id, {"history": [], "last_accessed": datetime.now()})
        history = session_data["history"]

        # Add user's message to history for this turn
        history.append({"role": "user", "parts": [user_text]})

        # 3. Send conversation history to the LLM
        llm_text = ""
        try:
            model = genai.GenerativeModel('gemini-1.5-flash-latest')
            response = model.generate_content(history) # Pass the whole history
            llm_text = response.text
        except Exception as genai_error:
            print(f"GenAI Error: {genai_error}")
            llm_text = f"I heard you say: '{user_text}'. The LLM service seems to be unavailable at the moment."
            # Important: Remove the user's message from history if the LLM call fails
            history.pop()

        # Add LLM's response to history only if the call was successful
        if "The LLM service seems to be unavailable" not in llm_text:
            history.append({"role": "model", "parts": [llm_text]})

        # Update the history and last_accessed timestamp in our datastore
        chat_histories[session_id] = {"history": history, "last_accessed": datetime.now()}

        # 4. Synthesize the LLM's text response into audio
        if len(llm_text) > 3000:
            llm_text = llm_text[:2900] + "..."

        audio_url = None
        try:
            murf_response = client.text_to_speech.generate(
                text=llm_text, voice_id="en-US-ken", style="Conversational"
            )
            audio_url = murf_response.audio_file
        except Exception as murf_error:
            print(f"Murf TTS Error: {murf_error}")
            return {"audio_url": None, "user_transcript": user_text, "llm_response_text": llm_text, "error": "TTS generation failed"}

        # 5. Return all relevant data to the client
        return {"audio_url": audio_url, "user_transcript": user_text, "llm_response_text": llm_text}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Unexpected error in agent chat: {e}")
        raise HTTPException(status_code=500, detail=f"Agent chat failed: {str(e)}")


# --- Background Task for Memory Management ---

def cleanup_old_sessions():
    """
    Periodically cleans up chat histories for sessions that have been inactive for over 24 hours.
    """
    while True:
        # Wait for 1 hour before running the cleanup
        time.sleep(3600)

        now = datetime.now()
        inactive_threshold = timedelta(hours=24)

        # Create a copy of session IDs to iterate over, as we might modify the dict
        session_ids_to_check = list(chat_histories.keys())

        print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Running cleanup task for {len(session_ids_to_check)} sessions...")

        cleaned_count = 0
        for session_id in session_ids_to_check:
            # Ensure the session still exists before trying to access it
            if session_id in chat_histories:
                last_accessed = chat_histories[session_id]["last_accessed"]
                if now - last_accessed > inactive_threshold:
                    print(f"  - Cleaning up inactive session: {session_id}")
                    del chat_histories[session_id]
                    cleaned_count += 1

        print(f"Cleanup finished. Removed {cleaned_count} inactive sessions.")

# Start the cleanup thread as a daemon so it doesn't block app shutdown
cleanup_thread = threading.Thread(target=cleanup_old_sessions, daemon=True)
cleanup_thread.start()