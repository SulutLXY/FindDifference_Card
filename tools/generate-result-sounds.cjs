// Original layered game cues; MP3 export uses FFmpeg (see compress-audio.cjs).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const rate = 44100;
const folder = path.resolve(__dirname, '../assets/resources/voice/ResultSound');
fs.mkdirSync(folder, { recursive: true });
const frequency = midi => 440 * Math.pow(2, (midi - 69) / 12);

function render(name, duration, notes, drums) {
    const count = Math.round(duration * rate);
    const left = new Float64Array(count);
    const right = new Float64Array(count);
    let seed = 1234567;
    function noise() {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2147483648 - 1;
    }
    function mix(i, value, pan) {
        left[i] += value * Math.cos((pan + 1) * Math.PI / 4);
        right[i] += value * Math.sin((pan + 1) * Math.PI / 4);
    }
    for (const [midi, start, length, gain, instrument, pan = 0] of notes) {
        const f = frequency(midi);
        for (let i = Math.ceil(start * rate); i < Math.min(count, (start + length) * rate); i++) {
            const t = i / rate - start;
            const attack = Math.min(1, t / (instrument === 'pad' ? 0.07 : 0.012));
            const release = Math.min(1, (length - t) / (instrument === 'pad' ? 0.28 : 0.12));
            let tone = 0;
            let envelope = attack * release;
            if (instrument === 'bell') {
                tone = Math.sin(2 * Math.PI * f * t)
                    + 0.35 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-4 * t)
                    + 0.16 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-6 * t);
                envelope *= Math.exp(-2.9 * t);
            } else if (instrument === 'brass') {
                for (let h = 1; h <= 6; h++) {
                    tone += Math.sin(2 * Math.PI * f * h * t + 0.012 * Math.sin(2 * Math.PI * 5 * t)) / Math.pow(h, 1.25);
                }
                envelope *= 0.7 + 0.3 * Math.exp(-5 * t);
            } else if (instrument === 'bass') {
                tone = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t);
                envelope *= Math.exp(-1.3 * t);
            } else {
                tone = 0.55 * Math.sin(2 * Math.PI * f * 0.998 * t)
                    + 0.55 * Math.sin(2 * Math.PI * f * 1.002 * t)
                    + 0.12 * Math.sin(2 * Math.PI * f * 2 * t);
            }
            mix(i, tone * envelope * gain, pan);
        }
    }
    for (const [start, length, gain, instrument, pan = 0] of drums) {
        let phase = 0;
        let previousNoise = 0;
        for (let i = Math.ceil(start * rate); i < Math.min(count, (start + length) * rate); i++) {
            const t = i / rate - start;
            const n = noise();
            let tone;
            if (instrument === 'kick' || instrument === 'tom') {
                const f = (instrument === 'kick' ? 55 : 90) + 110 * Math.exp(-22 * t);
                phase += 2 * Math.PI * f / rate;
                tone = Math.sin(phase) * Math.exp(-12 * t) + n * 0.08 * Math.exp(-80 * t);
            } else {
                // High-passed noise shimmer with a short attack and a smooth tail.
                tone = (n - previousNoise) * Math.exp(-(instrument === 'snare' ? 22 : 5) * t);
            }
            previousNoise = n;
            mix(i, tone * gain * Math.min(1, t / 0.003) * Math.min(1, (length - t) / 0.08), pan);
        }
    }
    // Stereo early reflections and a diffuse tail, fed from the dry mix only.
    const dryLeft = left.slice();
    const dryRight = right.slice();
    for (const [delay, gain] of [[0.073, 0.16], [0.113, 0.13], [0.179, 0.10], [0.251, 0.075], [0.337, 0.055], [0.433, 0.04]]) {
        const offset = Math.round(delay * rate);
        for (let i = offset; i < count; i++) {
            left[i] += dryRight[i - offset] * gain;
            right[i] += dryLeft[i - offset] * gain;
        }
    }
    let peak = 0;
    for (let i = 0; i < count; i++) {
        const fade = Math.min(1, (count - 1 - i) / (rate * 0.18));
        left[i] = Math.tanh(left[i] * 1.5) * fade;
        right[i] = Math.tanh(right[i] * 1.5) * fade;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    const output = Buffer.alloc(44 + count * 4);
    output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
    output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(2, 22);
    output.writeUInt32LE(rate, 24); output.writeUInt32LE(rate * 4, 28);
    output.writeUInt16LE(4, 32); output.writeUInt16LE(16, 34);
    output.write('data', 36); output.writeUInt32LE(count * 4, 40);
    const scale = 0.8 * 32767 / Math.max(peak, 0.001);
    for (let i = 0; i < count; i++) {
        output.writeInt16LE(Math.round(left[i] * scale), 44 + i * 4);
        output.writeInt16LE(Math.round(right[i] * scale), 46 + i * 4);
    }
    const meta = path.join(folder, name + '.mp3.meta');
    if (!fs.existsSync(meta)) fs.writeFileSync(meta, JSON.stringify({
        ver: '1.0.0', importer: 'audio-clip', imported: true, uuid: crypto.randomUUID(),
        files: ['.json', '.mp3'], subMetas: {}, userData: { downloadMode: 0 },
    }, null, 2) + '\n');
    require('./compress-audio.cjs').saveResult(name, output, duration);
}

// Three seconds: bell pickup, rising brass fanfare, dominant-to-tonic climax.
const victory = [
    [72, 0.00, 0.6, 0.22, 'bell', -0.35], [76, 0.14, 0.6, 0.22, 'bell', 0.35],
    [79, 0.28, 0.7, 0.24, 'bell', -0.25],
    [79, 0.48, 0.3, 0.20, 'brass'], [81, 0.78, 0.3, 0.22, 'brass'],
    [83, 1.08, 0.32, 0.24, 'brass'], [84, 1.44, 1.10, 0.29, 'brass'],
    [88, 1.48, 1.15, 0.16, 'bell', 0.4], [91, 1.64, 0.98, 0.12, 'bell', -0.4],
];
for (const [start, length, chord, bass] of [
    [0.04, 0.7, [60, 64, 67], 48], [0.74, 0.7, [59, 62, 67], 43], [1.44, 1.23, [60, 64, 67, 72], 48],
]) {
    chord.forEach((note, i) => victory.push([note, start, length, 0.09, 'pad', i % 2 ? 0.55 : -0.55]));
    victory.push([bass, start, length, 0.25, 'bass']);
}
render('level-victory', 3, victory, [
    [0, 0.25, 0.28, 'kick'], [0.47, 0.18, 0.09, 'snare', -0.2],
    [0.77, 0.18, 0.10, 'snare', 0.2], [1.08, 0.25, 0.22, 'tom'],
    [1.32, 0.16, 0.13, 'snare'], [1.44, 0.35, 0.32, 'kick'], [1.44, 1.16, 0.12, 'shimmer', 0.3],
]);

// Two seconds: falling minor melody, warm low impact, sustained minor resolution.
const failure = [
    [67, 0.02, 0.38, 0.24, 'brass', -0.12], [65, 0.32, 0.38, 0.22, 'brass', 0.12],
    [63, 0.62, 0.38, 0.24, 'brass', -0.12], [60, 0.96, 0.77, 0.26, 'brass'],
    [72, 0.98, 0.7, 0.09, 'bell', 0.3], [48, 0.96, 0.85, 0.26, 'bass'],
];
for (const [start, length, chord] of [[0, 0.91, [55, 58, 62]], [0.95, 0.85, [48, 55, 60, 63]]]) {
    chord.forEach((note, i) => failure.push([note, start, length, 0.11, 'pad', i % 2 ? 0.5 : -0.5]));
}
render('level-failure', 2, failure, [
    [0, 0.3, 0.23, 'tom'], [0.63, 0.28, 0.13, 'tom', -0.2],
    [0.96, 0.36, 0.29, 'kick'], [0.97, 0.7, 0.045, 'shimmer', 0.2],
]);
const directoryMeta = folder + '.meta';
if (!fs.existsSync(directoryMeta)) fs.writeFileSync(directoryMeta, JSON.stringify({
    ver: '1.2.0', importer: 'directory', imported: true, uuid: crypto.randomUUID(),
    files: [], subMetas: {}, userData: {},
}, null, 2) + '\n');
