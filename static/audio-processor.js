class AudioDataProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
    }

    /**
     * The process method is called for every block of audio data.
     * @param {Float32Array[][]} inputs - An array of inputs, each with an array of channels.
     * @param {Float32Array[][]} outputs - An array of outputs, each with an array of channels.
     * @param {Record<string, Float32Array>} parameters - Audio-rate parameters.
     * @returns {boolean} - Return true to keep the processor alive.
     */
    process(inputs, outputs, parameters) {
        // We only expect one input, with one channel (mono).
        const inputChannel = inputs[0][0];

        // If the input channel is empty, do nothing.
        if (!inputChannel) {
            return true;
        }

        // Post the raw Float32Array data back to the main thread.
        // The data is sent as a transferable object to avoid copying.
        this.port.postMessage(inputChannel.buffer, [inputChannel.buffer]);

        // Return true to keep the processor alive and running.
        return true;
    }
}

// Register the processor to be used in the main thread.
registerProcessor('audio-data-processor', AudioDataProcessor);
