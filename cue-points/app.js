/**
 * Class that wraps an audio file for the playlist
 */
class AudioItem {
  constructor({src, name, cue}) {
    // Web audio source
    this.src = src
    // File name
    this.name = name
    // Cue object
    this.cue = cue
    // Audio object
    this.audio = new Audio
    this.audio.src = src
    this.audio.controls = true
    // Trigger witness
    this.next = false
    // Starts computing fading functions
    this.computeFades()
  }

  /**
   * This function computes fading functions.
   * Those functions adjusts the gain of the audio while it is playing
   * in order to fade the audio at the start and the end of the audio file.
   */
  computeFades() {
    let fadeInFunc, fadeOutFunc
    // If START = BEGIN
    if (this.cue.start === this.cue.begin) {
      // Brutal volume modification
      fadeInFunc = (time) => {
        return time < this.cue.begin ? 0.0 : 1.0
      }
    } else {
      // Linear function to fade in
      let a = 1 / (this.cue.start - this.cue.begin)
      let b = -a * this.cue.begin
      fadeInFunc = (time) => {
        let y = (a * time + b)
        return this.clamp(y, 0, 1)
      }
    }
    // If NEXT = END
    if (this.cue.next === this.cue.end) {
      // Brutal volume modification
      fadeOutFunc = (time) => {
        return time > this.cue.end ? 0.0 : 1.0
      }
    } else {
      // Linear function to fade out
      let a = -1 / (this.cue.end - this.cue.next)
      let b = -a * this.cue.end
      fadeOutFunc = (time) => {
        let y = (a * time + b)
        return this.clamp(y, 0, 1)
      }
    }
    // Global fade function
    this.fadeFunc = (time) => {
      let gain = fadeInFunc(time) * fadeOutFunc(time)
      return gain
    }
    // Fade in and fade out duration
    this.fadeInDuration = this.cue.start - this.cue.begin
    this.fadeOutDuration = this.cue.end - this.cue.next
  }

  /**
   * Clamp value that ensure that x is between min and max.
   */
  clamp(x, min, max) {
    return x < min ? min : x > max ? max : x
  }

  /**
   * Plays audio
   * You can define a time or a cue point where you want to start playing
   */
  play(from = 0) {
    if (typeof from === typeof '' && this.cue.hasOwnProperty(from)) {
      from = this.cue[from]
    }
    this.audio.currentTime = from
    this.audio.play()
  }

  /**
   * Pause audio
   */
  pause() {
    this.audio.pause()
  }

  /**
   * Starts loading file and call a function when it's done
   */
  load(callback) {
    this.audio.onloadedmetadata = callback
    this.audio.load()
  }

  /**
   * Routine function that is called for each request animation frame
   * previousTime: the currentTime of the file just before this one in the playlist
   * previousCue: the cue object of the file just before this one in the playlist
   */
  routine(previousTime, previousCue) {
    // Adjust volume (fade in / fade out)
    this.audio.volume = this.fadeFunc(this.audio.currentTime)
    // If there is a file just before this one ( = not the first)
    if (previousTime !== null && previousCue !== null) {
      // Time remaining before the next cue point of the file just before
      let beforeNext = previousCue.next - previousTime
      // Set the next trigger witness to false if the file has been rewind
      if (this.next && beforeNext >= this.fadeInDuration) {
        this.next = false
      }
      // Launch the current file if the next cue point was reached in the file just before
      if (!(this.next) && (beforeNext <= this.fadeInDuration)) {
        this.next = true
        this.play('begin')
      }
    }
    // Give data for the file just after in the playlist
    return {
      previousTime: this.audio.currentTime,
      previousCue: this.cue
    }
  }
}

/**
 * App
 */
const app = new Vue({
  el: '#app',
  data: {
    // Message displayed will computing cues
    message: '',
    // Audio context
    ctx: null,
    // File input model
    file: null,
    // Computing status
    computing: false,
    // Cue found status
    found: false,
    // Playing status
    playing: false,
    // Playlist
    playlist: [],
    // Cue object
    cue: {
      begin: 0.0,
      start: 0.0,
      next: 0.0,
      end: 0.0
    },
    // Settings model
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
    // Chunk size to compute cues
    // must be 0 or a power of 2 between 256 and 16384
    chunkSize: 256
  },
  methods: {
    /**
     * Read file audio data
     * Returns a promise with the full audio buffer
     */
    readData(file) {
      return new Promise((resolve) => {
        let reader = new FileReader
        reader.onload = (e) => {
          resolve(e.target.result.slice(0))
        }
        reader.readAsArrayBuffer(file)
      })
    },

    /**
     * Computes the rms of every channels of an audio buffer
     */
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

    /**
     * Translates a float number to a dBFS value
     */
    lin2db(lin) {
      return 20 * Math.log10(lin)
    },

    /**
     * Translates a chunk index to a time value
     */
    chunkIndexToSeconds(index, bufferSize, sampleRate) {
      return (index * bufferSize) / sampleRate
    },

    /**
     * Look for cues
     * source: audio source
     * level & duration: settings to find a cue at a quiet level
     * peak: settings to find a cue at a peak level
     * Returns a promise
     */
    findCue(source, level, duration, peak) {
      return new Promise((resolve) => {
        // Processor declaration
        let processor = this.ctx.createScriptProcessor(this.chunkSize, source.buffer.numberOfChannels, source.buffer.numberOfChannels)
        // Mute the output to avoid annoying audio while looking for cues
        let muter = this.ctx.createGain()
        muter.gain.value = 0
        // Time value if the cue is found
        let found = null
        // Time value if the cue is started to be found at a quiet level
        let detectionStart = null
        // Chunk index
        let index = 0
        // Processor implementation
        processor.onaudioprocess = (e) => {
          // If the cue is found, stops the process and resolve the promise
          if (found !== null) {
            source.stop()
            resolve(found)
            return
          }
          // Compute the RMS of the chunk
          // See that the chunk size is important!
          let rms = this.rms(e.inputBuffer)
          let db = this.lin2db(rms)
          if (db >= peak) {
            // If a cue is detected with a peak value
            // Store the time value
            found = this.chunkIndexToSeconds(index, this.chunkSize, source.buffer.sampleRate)
          } else if (db >= level) {
            // If we start to detect a cue at a quiet level…
            let now = this.chunkIndexToSeconds(index, this.chunkSize, source.buffer.sampleRate)
            if (detectionStart === null) {
              // … store the start time…
              detectionStart = now
            } else if (now - detectionStart >= duration) {
              // … or store the cue value if the cue is confirmed…
              found = now
            }
          } else {
            // … else, reset the quiet level detection.
            detectionStart = null
          }
          // Increment chunk index
          ++index
        }
        // Connect everything and start the computation
        source.connect(processor)
        processor.connect(muter)
        muter.connect(this.ctx.destination)
        source.start(0)
      })
    },

    /**
     * Process the cue points
     */
    async process(file) {
      // Starts the computing
      this.computing = true
      this.message = 'Reading file…'
      this.$forceUpdate()
      // Read audio data
      let data = await this.readData(file)
      // Creates 2 buffers: one for forward reading, one for backward reading
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
      // Starts cue points computing
      this.message = 'Looking for cue points…'
      let duration = source.buffer.duration
      this.$forceUpdate()
      this.cue.start = await this.findCue(source, this.settings.start_level, this.settings.start_duration, this.settings.start_peak_level)
      this.cue.next = await this.findCue(sourceReversed, this.settings.next_level, this.settings.next_duration, this.settings.next_peak_level)
      this.cue.begin = Math.max(0, this.cue.start - this.settings.begin_fade)
      this.cue.end = Math.max(0, this.cue.next - this.settings.end_fade)
      this.cue.next = duration - this.cue.next - this.settings.next_duration
      this.cue.end = duration - this.cue.end
      // Finish
      this.computing = false
      this.found = true
      this.$forceUpdate()
    },

    /**
     * Preview the audio at the time specified
     */
    playAt(cue) {
      this.$refs.audio.currentTime = cue
      this.$refs.audio.play()
    },

    /**
     * Button click bind, starts the cue computation
     */
    compute() {
      this.ctx = new AudioContext
      this.$refs.audio.src = URL.createObjectURL(this.$refs.file.files[0])
      this.process(this.$refs.file.files[0])
    },

    /**
     * Add the current audio file to the playlist and loads it
     */
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

    /**
     * Move the item inside the playlist
     */
    move(before, after) {
      if (before < 0 || after < 0 || before >= this.playlist.length || after >= this.playlist.length) return
      [this.playlist[before], this.playlist[after]] = [this.playlist[after], this.playlist[before]]
      this.$forceUpdate()
    },
    
    /**
     * Remove the item from the playlist
     */
    remove(index) {
      if (index < 0 || index >= this.playlist.length) return
      this.playlist.splice(index, 1)
    },

    /**
     * Routine of execution while reading playlist
     */
    routine() {
      // Launch routine functions for each playlist items
      let previousTime = null
      let previousCue = null
      this.playlist.forEach((item) => {
        ({ previousTime, previousCue } = item.routine(previousTime, previousCue))
      })
      this.$forceUpdate()
      // RAF if still playing
      requestAnimationFrame(() => {
        if (this.playing) {
          this.routine()
        }
      })
    },

    /**
     * Starts playlist
     */
    playPlaylist() {
      if (this.playlist.length < 1) return
      this.playing = true
      this.playlist[0].play('begin')
      this.routine()
    },

    /**
     * Stops playlist
     */
    stopPlaylist() {
      this.playing = false
      this.playlist.forEach((item) => {
        item.pause()
      })
    },

    /**
     * Format time for a given number of seconds (float)
     */
    formatTime(time) {
      let minutes = ~~(time / 60)
      let seconds = ('' + ((time % 60)).toFixed(2)).padStart(5, '0')
      return `${minutes}:${seconds}`
    }
  }
})
