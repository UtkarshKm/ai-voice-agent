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
from typing import Callable, Coroutine

class AssemblyAIStreamingTranscriber:
    def __init__(
        self,
        websocket: WebSocket,
        on_transcript_callback: Callable[[str], Coroutine],
        sample_rate: int = 16000,
        api_key: str = None,
    ):
        self.websocket = websocket
        self.on_transcript_callback = on_transcript_callback
        self.loop = asyncio.get_event_loop()

        if not api_key:
            raise ValueError("AssemblyAI API key is required.")

        self.client = StreamingClient(
            StreamingClientOptions(api_key=api_key, api_host="streaming.assemblyai.com")
        )
        self.client.on(StreamingEvents.Begin, self.on_begin)
        self.client.on(StreamingEvents.Turn, self.on_turn)
        self.client.on(StreamingEvents.Termination, self.on_termination)
        self.client.on(StreamingEvents.Error, self.on_error)

        self.client.connect(
            StreamingParameters(
                sample_rate=sample_rate,
                format_turns=True,
            )
        )

    def on_begin(self, _: StreamingClient, event: BeginEvent):
        print(f"Session started: {event.id}")

    def on_turn(self, _: StreamingClient, event: TurnEvent):
        transcript = event.transcript
        if not transcript:
            return

        print(f"Turn: {transcript} (end_of_turn={event.end_of_turn})")

        # If it's the end of a turn, process it with the callback
        if event.end_of_turn:
            if event.turn_is_formatted:
                # Use the final, formatted transcript for the callback
                asyncio.run_coroutine_threadsafe(
                    self.on_transcript_callback(transcript), self.loop
                )
            else:
                # If for some reason the turn isn't formatted yet, request it
                 self.client.set_params(StreamingSessionParameters(format_turns=True))
        # Otherwise, it's an interim result, send it to the client for display
        else:
            coro = self.websocket.send_text(
                json.dumps({"type": "transcript", "data": transcript})
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
