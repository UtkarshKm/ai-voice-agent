import assemblyai as aai
from assemblyai.streaming.v3 import (
    StreamingClient,
    StreamingClientOptions,
    StreamingParameters,
    StreamingSessionParameters,
    StreamingEvents,
    BeginEvent,
    TurnEvent,
    TerminationEvent,
    StreamingError,
)
import os
import json
import asyncio
from fastapi import WebSocket

aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")

class AssemblyAIStreamingTranscriber:
    def __init__(self, websocket: WebSocket, sample_rate=16000):
        self.websocket = websocket
        self.loop = asyncio.get_event_loop()
        self.client = StreamingClient(
            StreamingClientOptions(
                api_key=aai.settings.api_key, api_host="streaming.assemblyai.com"
            )
        )
        self.client.on(StreamingEvents.Begin, self.on_begin)
        self.client.on(StreamingEvents.Turn, self.on_turn)
        self.client.on(StreamingEvents.Termination, self.on_termination)
        self.client.on(StreamingEvents.Error, self.on_error)

        self.client.connect(StreamingParameters(sample_rate=sample_rate, format_turns=True))

    def on_begin(self, _: StreamingClient, event: BeginEvent):
        print(f"Session started: {event.id}")

    def on_turn(self, _: StreamingClient, event: TurnEvent):
        print(f"{event.transcript} (end_of_turn={event.end_of_turn})")
        if event.end_of_turn and event.turn_is_formatted:
            coro = self.websocket.send_text(
                json.dumps({"type": "transcript", "data": event.transcript})
            )
            asyncio.run_coroutine_threadsafe(coro, self.loop)

    def on_termination(self, _: StreamingClient, event: TerminationEvent):
        print(f"Session terminated after {event.audio_duration_seconds} s")

    def on_error(self, _: StreamingClient, error: StreamingError):
        print("Error:", error)

    def stream_audio(self, audio_chunk: bytes):
        self.client.stream(audio_chunk)

    def close(self):
        self.client.disconnect(terminate=True)
