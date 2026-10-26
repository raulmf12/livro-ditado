// AudioWorklet: converte a entrada (Float32, já a 16 kHz) em PCM Int16 e envia
// pedaços de `chunkSamples` amostras, com o nível RMS de cada pedaço.
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.size = options.processorOptions.chunkSamples
    this.buf = new Int16Array(this.size)
    this.n = 0
    this.sumSq = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]))
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      this.sumSq += s * s
      if (this.n === this.size) {
        const level = Math.sqrt(this.sumSq / this.size)
        this.port.postMessage({ pcm: this.buf.buffer, level }, [this.buf.buffer])
        this.buf = new Int16Array(this.size)
        this.n = 0
        this.sumSq = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
