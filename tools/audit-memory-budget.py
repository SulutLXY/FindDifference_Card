"""Static resource memory baseline; this does not measure live JS/native/GPU usage."""
import argparse
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
rel = lambda p: p.relative_to(ROOT).as_posix()


def audio_info(path):
    probe = shutil.which('ffprobe')
    if not probe:
        return dict(path=rel(path), encodedBytes=path.stat().st_size, pcmFloat32Bytes=None)
    result = subprocess.run([probe, '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                             'stream=sample_rate,channels:format=duration', '-of', 'json', str(path)],
                            capture_output=True, text=True, encoding='utf-8', check=True)
    info = json.loads(result.stdout)
    stream = info['streams'][0]
    seconds = float(info['format']['duration'])
    rate, channels = int(stream['sample_rate']), int(stream['channels'])
    return dict(path=rel(path), encodedBytes=path.stat().st_size, durationSeconds=round(seconds, 3),
                sampleRate=rate, channels=channels, pcmFloat32Bytes=round(seconds*rate*channels*4))


def audit():
    index = read(ROOT/'assets/resources/configs/cities.json')
    roots = {'resources': ROOT/'assets/resources', 'MainGameSources': ROOT/'assets/PleyGame',
             'LobbySources': ROOT/'assets/LobbySources', 'MainGameAimation': ROOT/'assets/Bundle/MainGameAimation',
             'chapter-covers': ROOT/'assets/Bundle/chapter-covers', 'food-icons': ROOT/'assets/Bundle/food-icons'}
    roots.update({key: ROOT/'assets/Bundle/levels'/key for key in index['cities']})
    bundles, images = {}, {}
    for key, root in roots.items():
        files = [p for p in root.rglob('*') if p.is_file()]
        pictures = []
        for p in files:
            if p.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
                continue
            with Image.open(p) as image:
                width, height = image.size
            record = dict(path=rel(p), width=width, height=height, encodedBytes=p.stat().st_size,
                          rgba8Bytes=width*height*4)
            pictures.append(record)
            images[rel(p)] = record
        audio_files = [p for p in files if p.suffix.lower() in ('.mp3', '.wav', '.ogg', '.m4a')]
        with ThreadPoolExecutor(max_workers=4) as workers:
            audio = list(workers.map(audio_info, audio_files))
        bundles[key] = dict(imageCount=len(pictures), encodedImageBytes=sum(p['encodedBytes'] for p in pictures),
                            rgba8SourceImageBytes=sum(p['rgba8Bytes'] for p in pictures),
                            largestImages=sorted(pictures, key=lambda p:p['rgba8Bytes'], reverse=True)[:5],
                            audioCount=len(audio), encodedAudioBytes=sum(a['encodedBytes'] for a in audio),
                            pcmFloat32IfAllDecodedBytes=sum(a['pcmFloat32Bytes'] or 0 for a in audio), audio=audio)
    levels = []
    for key, chapter in index['chapters'].items():
        for entry in chapter['levels']:
            config = read(roots[key]/'configs'/entry['folder']/'differences.json')
            pair = []
            for field, stem in (('topImage', 'scene-a'), ('bottomImage', 'scene-b')):
                request = config.get(field, f"levels/{key}/{entry['folder']}/{stem}/spriteFrame")
                base = ROOT/'assets/Bundle'/request.removesuffix('/spriteFrame')
                file = next(p for ext in ('.jpg', '.png', '.jpeg', '.webp') if (p := base.with_suffix(ext)).exists())
                pair.append(images[rel(file)])
            levels.append(dict(id=entry['id'], name=entry['name'], chapter=key,
                               rgba8PairBytes=sum(p['rgba8Bytes'] for p in pair),
                               encodedPairBytes=sum(p['encodedBytes'] for p in pair), images=pair))
    pair_sizes = sorted(row['rgba8PairBytes'] for row in levels)
    # Resolve source prefab/animation UUID references to unique images, avoiding a whole-bundle residency assumption.
    uuid_files = {}
    for meta in (ROOT/'assets').rglob('*.meta'):
        data = read(meta)
        source = meta.with_suffix('')
        for item in [data, *data.get('subMetas', {}).values()]:
            if item.get('uuid'):
                uuid_files[item['uuid']] = source
    scopes = {}
    scope_roots = {
        'startupScene': ['assets/scene/game.scene'],
        'gameplayUI': ['assets/PleyGame/prefabs/GameScreen.prefab', 'assets/PleyGame/prefabs/ResultModal.prefab', 'assets/PleyGame/prefabs/GameplaySupport.prefab'],
        'homeUI': ['assets/LobbySources/prefabs/LobbyScreen.prefab'],
        'homeHeroAnimation': ['assets/Bundle/MainGameAimation/N_Cat_01/An_MainGame_N_Cat_01.anim'],
        'chapterSelectUI': ['assets/LobbySources/prefabs/CitySelectScreen.prefab'],
        'levelSelectUI': ['assets/LobbySources/prefabs/LevelSelectScreen.prefab'],
        'collectionUI': ['assets/LobbySources/SecondaryUI/prefabs/CollectScreen.prefab'],
    }
    for name, entries in scope_roots.items():
        visited, selected = set(), set()

        def visit_file(p):
            if p in visited or not p.is_file():
                return
            visited.add(p)
            if rel(p) in images:
                selected.add(rel(p))
            elif p.suffix in ('.prefab', '.anim', '.scene', '.json', '.mtl'):
                visit_value(read(p))

        def visit_value(value):
            if isinstance(value, dict):
                target = uuid_files.get(value.get('__uuid__'))
                if target:
                    visit_file(target)
                for item in value.values():
                    visit_value(item)
            elif isinstance(value, list):
                for item in value:
                    visit_value(item)

        for entry in entries:
            assert (ROOT/entry).is_file(), entry
            visit_file(ROOT/entry)
        scopes[name] = dict(roots=entries, imageCount=len(selected),
                           rgba8SourceImageBytes=sum(images[p]['rgba8Bytes'] for p in selected), images=sorted(selected))
    return dict(date='2026-11-27', kind='static-baseline-not-runtime-measurement',
        assumptions=['Texture estimate = source width * height * 4 (RGBA8), without mipmaps.',
                     'Build atlas padding/duplication, texture compression, CPU image copies, font atlases and render targets are not included.',
                     'Audio estimate assumes all source clips decoded to float32 PCM. Platform streaming/native playback may differ.',
                     'Disk/HTTP cache bytes are not resident texture bytes. Bundle presence does not mean all textures are loaded.',
                     'Figures exclude engine, JS heap, native objects, drivers and host app. They are not a total memory or peak measurement.'],
        levelCount=len(levels),
        levelImages=dict(totalRgba8Bytes=sum(pair_sizes), minPairBytes=pair_sizes[0],
                         medianPairBytes=pair_sizes[len(pair_sizes)//2], maxPairBytes=pair_sizes[-1],
                         maxAdjacentTransitionBytes=max(a['rgba8PairBytes']+b['rgba8PairBytes'] for a,b in zip(levels, levels[1:]))),
        bundles=bundles, sourceDependencyScopes=scopes,
        largestLevels=sorted(levels, key=lambda row:row['rgba8PairBytes'], reverse=True)[:10])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = audit()
    if args.output:
        destination = args.output.resolve()
        assert destination.is_relative_to(ROOT), 'Write audit reports inside the project'
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    mib = lambda n: round(n/1048576, 2)
    print(json.dumps(dict(levelCount=report['levelCount'], levelImages=report['levelImages'],
        sourceScopes={key:dict(images=value['imageCount'], rgba8MiB=mib(value['rgba8SourceImageBytes'])) for key,value in report['sourceDependencyScopes'].items()},
        bundles={key:dict(images=value['imageCount'], rgba8MiB=mib(value['rgba8SourceImageBytes']),
                         encodedImagesMiB=mib(value['encodedImageBytes']), audio=value['audioCount'],
                         pcm32MiB=mib(value['pcmFloat32IfAllDecodedBytes'])) for key,value in report['bundles'].items()})))
