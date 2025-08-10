from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from murf import Murf
import os
from dotenv import load_dotenv
import assemblyai as aai
from google import genai

# Load environment variables
load_dotenv()

# Initialize AssemblyAI
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")

# Initialize Google GenAI client
genai_client = genai.Client()

app = FastAPI(title="AI Voice Agent - Day 8 - Utkarsh Kumawat", version="1.0.0")

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
    and returns the LLM's response as synthesized audio.
    """
    try:
        # 1. Transcribe the user's audio
        audio_data = await file.read()
        transcriber = aai.Transcriber()
        user_transcript = transcriber.transcribe(audio_data)

        if user_transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {user_transcript.error}")

        user_text = user_transcript.text
        if not user_text or not user_text.strip():
            return {
                "audio_url": None, 
                "user_transcript": "(No speech detected)", 
                "llm_response_text": ""
            }

        # 2. Send the transcript to the LLM with a directive for a concise response
        prompt = f"Please provide a concise response, under 3000 characters. User query: '{user_text}'"
        
        # Fixed Google GenAI usage - using the client properly
        try:
            # Option 1: Using the new Google GenAI API structure
            response = genai_client.models.generate_content(
            model="gemini-2.5-flash", contents=[prompt]
)
            llm_text = response.text
        except Exception as genai_error:
            # Fallback or alternative approach
            print(f"GenAI Error: {genai_error}")
            # You might want to use a different model or handle this differently
            llm_text = f"I heard you say: '{user_text}'. This is a test response since the LLM service is currently unavailable."

        # Ensure the response isn't too long for TTS
        if len(llm_text) > 3000:
            llm_text = llm_text[:2900] + "..."

        # 3. Synthesize the LLM's text response into audio using Murf
        try:
            murf_response = client.text_to_speech.generate(
                text=llm_text,
                voice_id="en-US-ken",
                style="Conversational"
            )
            audio_url = murf_response.audio_file
        except Exception as murf_error:
            print(f"Murf TTS Error: {murf_error}")
            # Return response without audio if TTS fails
            return {
                "audio_url": None,
                "user_transcript": user_text,
                "llm_response_text": llm_text,
                "error": "TTS generation failed"
            }

        # 4. Return all relevant data to the client
        return {
            "audio_url": audio_url,
            "user_transcript": user_text,
            "llm_response_text": llm_text
        }

    except HTTPException:
        # Re-raise HTTP exceptions as they are
        raise
    except Exception as e:
        print(f"Unexpected error in LLM query: {e}")
        raise HTTPException(status_code=500, detail=f"LLM query failed: {str(e)}")