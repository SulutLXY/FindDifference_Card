// Usage: node tools/compress-audio.cjs (FFMPEG_PATH can override the encoder).
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const work = path.join(root, 'temp/audio-compression');
function encoder() {
    const bundled = path.join(work, 'deps/imageio_ffmpeg/binaries');
    const exe = process.env.FFMPEG_PATH || (fs.existsSync(bundled) && fs.readdirSync(bundled).find(n => n.endsWith('.exe')));
    const result = process.env.FFMPEG_PATH || (exe && path.join(bundled, exe)) || 'ffmpeg';
    const check = cp.spawnSync(result, ['-version'], { windowsHide: true });
    if (check.error || check.status !== 0) throw Error('FFmpeg unavailable; set FFMPEG_PATH.');
    return result;
}
function run(exe, args) {
    const r = cp.spawnSync(exe, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw Error(r.error?.message || r.stderr.toString());
    return r.stdout;
}
function decoded(exe, file) {
    const pcm = run(exe, ['-v','error','-i',file,'-f','f32le','-ac','2','-ar','22050','pipe:1']);
    let energy = 0;
    for (let i = 0; i < pcm.length; i += 4) { const sample = pcm.readFloatLE(i); if (!Number.isFinite(sample)) throw Error('Invalid sample'); energy += sample * sample; }
    return { duration: pcm.length / (22050 * 2 * 4), rms: Math.sqrt(energy / (pcm.length / 4)) };
}
function transcode(exe, source, target, bitrate) {
    run(exe, ['-v','error','-y','-i',source,'-map_metadata','-1','-vn','-c:a','libmp3lame','-b:a',`${bitrate}k`,'-ar','44100','-ac','2',target]);
    const before = decoded(exe, source), after = decoded(exe, target);
    if (Math.abs(before.duration - after.duration) > 0.06 || after.rms < before.rms * 0.8 || after.rms > before.rms * 1.2) throw Error(`Audio validation failed: ${source}`);
    return { before, after };
}
function saveResult(name, buffer, duration) {
    const exe = encoder();
    fs.mkdirSync(work, { recursive: true });
    const source = path.join(work, name + '-source.wav');
    fs.writeFileSync(source, buffer);
    const output = path.join(root, 'assets/resources/voice/ResultSound', name + '.mp3');
    if (!fs.existsSync(output + '.meta')) throw Error('Missing existing result audio metadata: ' + output);
    const temporary = path.join(work, name + '-encoded.mp3');
    transcode(exe, source, temporary, 96);
    fs.copyFileSync(temporary, output);
    console.log(`${name}.mp3: ${duration}s, stereo, 96kbps`);
}
function main() {
    const exe = encoder();
    const backup = path.join(work, 'originals-' + Date.now());
    fs.mkdirSync(backup, { recursive: true });
    function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : /\.(wav|mp3)$/i.test(e.name) ? [path.join(dir,e.name)] : []); }
    const report = [];
    for (const source of files(path.join(root,'assets'))) {
        const relative = path.relative(root,source);
        const original = path.join(backup,relative);
        fs.mkdirSync(path.dirname(original), { recursive:true });
        fs.copyFileSync(source,original);
        fs.copyFileSync(source+'.meta',original+'.meta');
        const resultSound = relative.includes('ResultSound');
        const target = /\.wav$/i.test(source) ? source.replace(/\.wav$/i,'.mp3') : source;
        const temporary = path.join(work, 'encoded.mp3');
        const stats = transcode(exe,source,temporary,resultSound ? 96 : 64);
        const oldBytes = fs.statSync(source).size, newBytes = fs.statSync(temporary).size;
        // Avoid another lossy generation when an already compressed file saves little.
        if (newBytes >= oldBytes * 0.95) { report.push({file:relative,oldBytes,newBytes:oldBytes,skipped:true}); continue; }
        const meta = JSON.parse(fs.readFileSync(source+'.meta','utf8'));
        fs.copyFileSync(temporary,target);
        if (target !== source) {
            meta.files = meta.files.map(f=>f === '.wav' ? '.mp3' : f);
            fs.writeFileSync(target+'.meta',JSON.stringify(meta,null,2)+'\n');
            fs.unlinkSync(source); fs.unlinkSync(source+'.meta');
        }
        if (JSON.parse(fs.readFileSync(target+'.meta','utf8')).uuid !== meta.uuid) throw Error('UUID changed');
        report.push({file:relative,output:path.relative(root,target),oldBytes,newBytes,...stats});
    }
    fs.writeFileSync(path.join(work,'report.json'),JSON.stringify({backup,files:report},null,2));
    console.log(JSON.stringify({files:report.length,before:report.reduce((n,r)=>n+r.oldBytes,0),after:report.reduce((n,r)=>n+r.newBytes,0),backup}));
}
module.exports = {saveResult};
if (require.main === module) main();
