let app = new Vue({
  el: '#app',
  data: {
    ctx: new AudioContext,
    file: null,
    computing: false,
    cue: {
      begin: 0.0,
      start: 0.0,
      next: 0.0,
      end: 0.0
    },
    settings: {
      start_peak_level: -15.0,
      start_level: -25.0,
      start_duration: 1.0,
      next_peak_level: -15.0,
      next_level: -25.0,
      next_duration: 1.0,
      begin_fade: 0.0,
      end_fade: 0.5
    },
    chunkSize: 256 // must be 0 or a power of 2 between 256 and 16384
  },
  methods: {
    readData(file) {
      return new Promise((resolve) => {
        let reader = new FileReader
        reader.onload = (e) => {
          resolve(e.target.result.slice(0))
        }
        reader.readAsArrayBuffer(file)
      })
    },

    rms(buffer) {
      let globalSum = 0.0
      for (let c = 0; c < buffer.numberOfChannels; ++c) {
        let channelSum = 0.0
        let input = buffer.getChannelData(c)
        for (let i = 0; i < input.length; ++i) {
          channelSum += input[i] * input[i]
        }
        let channelRms = Math.sqrt(channelSum / input.length)
        globalSum += channelRms * channelRms
      }
      return Math.sqrt(globalSum / buffer.numberOfChannels)
    },

    lin2db(lin) {
      return 20 * Math.log10(lin)
    },

    chunkIndexToSeconds(index, bufferSize, sampleRate) {
      return (index * bufferSize) / sampleRate
    },

    findCue(source, level, duration, peak) {
      return new Promise((resolve) => {
        let processor = this.ctx.createScriptProcessor(this.chunkSize, source.buffer.numberOfChannels, source.buffer.numberOfChannels)
        let muter = this.ctx.createGain()
        muter.gain.value = 0
        let found = null
        let detectionStart = null
        let index = 0
        processor.onaudioprocess = (e) => {
          if (found !== null) {
            source.stop()
            resolve(found)
            return
          }
          ++index
          let rms = this.rms(e.inputBuffer)
          let db = this.lin2db(rms)
          if (db >= peak) {
            found = this.chunkIndexToSeconds(index, this.chunkSize, source.buffer.sampleRate)
          } else if (db >= level) {
            let now = this.chunkIndexToSeconds(index, this.chunkSize, source.buffer.sampleRate)
            if (detectionStart === null) {
              detectionStart = now
            } else if (now - detectionStart >= duration) {
              found = now
            }
          } else {
            detectionStart = null
          }
        }
        source.connect(processor)
        processor.connect(muter)
        muter.connect(this.ctx.destination)
        source.start(0)
      })
    },

    async process(file) {
      this.computing = true
      this.$forceUpdate()
      let data = await this.readData(file)
      let buffer = await this.ctx.decodeAudioData(data.slice(0))
      let bufferReversed = await this.ctx.decodeAudioData(data.slice(0))
      for (let i = 0; i < bufferReversed.numberOfChannels; ++i) {
        let channel = bufferReversed.getChannelData(i)
        Array.prototype.reverse.call(channel)
      }
      let source = this.ctx.createBufferSource()
      let sourceReversed = this.ctx.createBufferSource()
      source.buffer = buffer
      sourceReversed.buffer = bufferReversed
      let duration = source.buffer.duration
      this.cue.start = await this.findCue(source, this.settings.start_level, this.settings.start_duration, this.settings.start_peak_level)
      this.cue.next = await this.findCue(sourceReversed, this.settings.next_level, this.settings.next_duration, this.settings.next_peak_level)
      this.cue.begin = Math.max(0, this.cue.start - this.settings.begin_fade)
      this.cue.end = Math.max(0, this.cue.next - this.settings.end_fade)
      this.cue.next = duration - this.cue.next
      this.cue.end = duration - this.cue.end
      this.computing = false
      this.$forceUpdate()
    },

    compute() {
      this.$refs.audio.src = URL.createObjectURL(this.$refs.file.files[0])
      this.process(this.$refs.file.files[0])
    }
  }
})
