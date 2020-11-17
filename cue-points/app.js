class AudioItem {
  constructor({src, name, cue}) {
    this.src = src
    this.name = name
    this.cue = cue
    this.audio = document.createElement('audio')
    this.audio.src = src
    this.audio.controls = true
    this.next = false
    this.previous = 0
    this.computeFades()
  }

  computeFades() {
    let fadeInFunc, fadeOutFunc
    if (this.cue.start === this.cue.begin) {
      fadeInFunc = (time) => {
        return time < this.cue.begin ? 0.0 : 1.0
      }
    } else {
      let a = 1 / (this.cue.start - this.cue.begin)
      let b = -a * this.cue.begin
      fadeInFunc = (time) => {
        let y = (a * time + b)
        return this.clamp(y, 0, 1)
      }
    }

    if (this.cue.next === this.cue.end) {
      fadeOutFunc = (time) => {
        return time > this.cue.end ? 0.0 : 1.0
      }
    } else {
      let a = -1 / (this.cue.end - this.cue.next)
      let b = -a * this.cue.end
      fadeOutFunc = (time) => {
        let y = (a * time + b)
        return this.clamp(y, 0, 1)
      }
    }
    this.fadeFunc = (time) => {
      let gain = fadeInFunc(time) * fadeOutFunc(time)
      return gain
    }
    this.fadeInDuration = this.cue.start - this.cue.begin
    this.fadeOutDuration = this.cue.end - this.cue.next
  }

  clamp(x, min, max) {
    return x < min ? min : x > max ? max : x
  }

  appendTo(el) {
    el.appendChild(this.audio)
  }

  play(from = 0) {
    if (typeof from === typeof '' && this.cue.hasOwnProperty(from)) {
      from = this.cue[from]
    }
    this.audio.currentTime = from
    this.audio.play()
  }

  pause() {
    this.audio.pause()
  }

  load(callback) {
    this.audio.onloadedmetadata = callback
    this.audio.load()
  }

  routine(previousTime, previousCue) {
    this.audio.volume = this.fadeFunc(this.audio.currentTime)
    if (previousTime !== null && previousCue !== null) {
      let beforeNext = previousCue.next - previousTime
      if (this.next && beforeNext >= this.fadeInDuration) {
        this.next = false
      }
      if (!(this.next) && (beforeNext <= this.fadeInDuration)) {
        this.next = true
        this.play('begin')
      }
    }
    this.previous = this.audio.currentTime
    return {
      previousTime: this.previous,
      previousCue: this.cue
    }
  }
}

let app = new Vue({
  el: '#app',
  data: {
    message: '',
    ctx: null,
    file: null,
    computing: false,
    found: false,
    playlist: [],
    playing: false,
    cue: {
      begin: 0.0,
      start: 0.0,
      next: 0.0,
      end: 0.0
    },
    settings: {
      start_peak_level: -15.0,
      start_level: -30.0,
      start_duration: 0.5,
      next_peak_level: -15.0,
      next_level: -30.0,
      next_duration: 0.5,
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
      this.message = 'Reading file…'
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
      this.message = 'Looking for cue points…'
      this.$forceUpdate()
      this.cue.start = await this.findCue(source, this.settings.start_level, this.settings.start_duration, this.settings.start_peak_level)
      this.cue.next = await this.findCue(sourceReversed, this.settings.next_level, this.settings.next_duration, this.settings.next_peak_level)
      this.cue.begin = Math.max(0, this.cue.start - this.settings.begin_fade)
      this.cue.end = Math.max(0, this.cue.next - this.settings.end_fade)
      this.cue.next = duration - this.cue.next - this.settings.next_duration
      this.cue.end = duration - this.cue.end
      this.computing = false
      this.found = true
      this.$forceUpdate()
    },

    playAt(cue) {
      this.$refs.audio.currentTime = cue
      this.$refs.audio.play()
    },

    compute() {
      this.ctx = new AudioContext
      this.$refs.audio.src = URL.createObjectURL(this.$refs.file.files[0])
      this.process(this.$refs.file.files[0])
    },

    add() {
      let audio = new AudioItem({
        src: this.$refs.audio.src,
        name: this.$refs.file.value.replace(/^.*[\\\/]/, ''),
        cue: Object.assign({}, this.cue)
      })
      audio.load(() => {
        this.playlist.push(audio)
        this.$forceUpdate()
      })
    },

    move(before, after) {
      if (before < 0 || after < 0 || before >= this.playlist.length || after >= this.playlist.length) return
      [this.playlist[before], this.playlist[after]] = [this.playlist[after], this.playlist[before]]
      this.$forceUpdate()
    },
    
    remove(index) {
      if (index < 0 || index >= this.playlist.length) return
      this.playlist.splice(index, 1)
    },

    routine() {
      let previousTime = null
      let previousCue = null
      this.playlist.forEach((item) => {
        ({ previousTime, previousCue } = item.routine(previousTime, previousCue))
      })
      this.$forceUpdate()
      requestAnimationFrame(() => {
        if (this.playing) {
          this.routine()
        }
      })
    },

    playPlaylist() {
      if (this.playlist.length < 1) return
      this.playing = true
      this.playlist[0].play('begin')
      this.routine()
    },

    stopPlaylist() {
      this.playing = false
      this.playlist.forEach((item) => {
        item.pause()
      })
    },

    formatTime(time) {
      let minutes = ~~(time / 60)
      let seconds = ('' + ((time % 60)).toFixed(2)).padStart(5, '0')
      return `${minutes}:${seconds}`
    }
  }
})
