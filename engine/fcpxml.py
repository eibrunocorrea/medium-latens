#!/usr/bin/env python3
"""fcpxml.py — gera timeline XMEML (FCP7 XML) para import no Premiere (F3).

Premiere importa via app.openFCPXML (tool import_fcp_xml do bridge) — a edição é
computada FORA do Premiere e entra como SEQUÊNCIA NOVA (rebuild, não mutação;
contorna os no-ops de edição estrutural do 26.3). Masters nunca são tocados.

Entrada: um cuts JSON (engine/cuts.py gera o de silence-cut; edições multicam
adicionam "overlays"):
{
  "sequence_name": "...",
  "base": {"file": "/abs/master.mp4", "segments": [{"in": 0.0, "out": 22.1}, ...]},
  // segment aceita "speed": N (%, default 100) — 600 = 6x; encolhe só a duração
  // na timeline, o trecho no source continua o mesmo (Time Remap, editável no Premiere).
  // ATENÇÃO: Time Remap sobre H.264/HEVC 4K Long-GOP dá frame PRETO no preview do
  // Premiere (não sustenta o decode). Para acelerar 4K, pré-renderize o trecho com
  // ffmpeg (setpts) e aponte o segment pro arquivo via "file" — clipe a 100%, sem preto.
  // segment aceita "file": "/abs/outro.mov" (default: o base) e "audio": false
  // (default: true só p/ o base) — trecho pré-renderizado entra em V1 sem clipitem em A1.
  "overlays": [{"file": "/abs/cam1.mp4", "tl_start": 30.0, "src_in": 32.0, "dur": 3.0}, ...],
  "music": {"file": "/abs/trilha.wav", "tl_start": 0.0},   // opcional → A3 contínua
  "vo": [{"file": "/abs/vo1.wav", "tl_start": 3.0}, ...],  // opcional → A2 (voice-over)
  "base_audio": "on",   // opcional: "on" (default) | "muted" | "off"
  "width": 3840, "height": 2160, "fps": 29.97   // opcionais; default = probe do base
}
Base: segments emendados (butt-joined) em V1+A1, áudio contínuo do base.
Overlays: V2, posicionados em tempo DA TIMELINE (já pós-cortes — caller calcula).
Music: A3, arquivo contínuo de tl_start até o fim da timeline
(ou do arquivo, o que vier antes) — ex. música pra duckar no Premiere.
VO: A2 (VO assume a track antes reservada p/ SFX) — um clipitem por arquivo, em tempo
DA TIMELINE, duração = duração do arquivo de áudio; item que sobrepõe o próximo VO é
pulado com AVISO. base_audio: "muted" = clipitems de A1 com <enabled>FALSE</enabled>
(mute pré-marcado, editável no Premiere); "off" = a track A1 nem é emitida (o vídeo
V1 continua intacto). Music continua em A3.

--audio-xfade N: crossfade de áudio "Constant Power" (KGAudioTransCrossFade) de N
frames, centrado em cada junção interna de A1. Junção só ganha xfade se os DOIS
clipitems têm handle de N/2 frames no source (esquerdo: out+N/2 ≤ fim do arquivo;
direito: in−N/2 ≥ 0) e duram ≥ N frames — senão a junção fica seca (skip).

Uso:  python3 engine/fcpxml.py "<cuts.json>" [-o saida.xml]
        [--audio-xfade N]
Saída (última linha): XMEML=<path>  SEGMENTS=<n>  OVERLAYS=<n>  DURATION=<s>  XFADES=<n>  MUSIC=<0|1>  VO=<n>  BASE_AUDIO=<modo>
"""
import argparse
import json
import subprocess
import sys
from fractions import Fraction
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape


def die(msg, code=1):
    print(f"ERRO: {msg}")
    sys.exit(code)


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate,duration", "-of", "json", str(path)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        die(f"ffprobe falhou em {path}: {r.stderr[:200]}")
    s = json.loads(r.stdout)["streams"][0]
    fps = Fraction(s["r_frame_rate"])
    return {"width": int(s["width"]), "height": int(s["height"]),
            "fps": fps, "duration": float(s.get("duration", 0))}


def rate_xml(fps: Fraction) -> str:
    ntsc = fps.denominator == 1001
    timebase = round(float(fps))
    return f"<rate><timebase>{timebase}</timebase><ntsc>{'TRUE' if ntsc else 'FALSE'}</ntsc></rate>"


def pathurl(p: Path) -> str:
    return "file://localhost" + quote(str(p))


def file_xml(fid, p: Path, info, rate) -> str:
    dur_f = int(info["duration"] * info["fps"])
    return (f'<file id="{fid}"><name>{escape(p.name)}</name>'
            f"<pathurl>{pathurl(p)}</pathurl>{rate}<duration>{dur_f}</duration>"
            f"<media><video><samplecharacteristics>{rate}"
            f"<width>{info['width']}</width><height>{info['height']}</height>"
            f"</samplecharacteristics></video>"
            f"<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>"
            f"</samplecharacteristics><channelcount>2</channelcount></audio></media></file>")


def audio_probe(path):
    """Duração de um arquivo de áudio (music pode ser wav/mp3 sem stream de vídeo)."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "json", str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        die(f"ffprobe falhou em {path}: {r.stderr[:200]}")
    return float(json.loads(r.stdout)["format"]["duration"])


def audio_file_xml(fid, p: Path, dur_f, rate) -> str:
    return (f'<file id="{fid}"><name>{escape(p.name)}</name>'
            f"<pathurl>{pathurl(p)}</pathurl>{rate}<duration>{dur_f}</duration>"
            f"<media><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>"
            f"</samplecharacteristics><channelcount>2</channelcount></audio></media></file>")


def xfade_xml(cut_f, n, rate) -> str:
    """Transition-item de áudio Constant Power centrado no frame `cut_f`.

    Encoding = o que o próprio Premiere 26.3 pt-BR emite ao exportar sua transição
    nativa "Potência Constante" via exportAsFinalCutProXML: name "Cross Fade ( 0dB)"
    + effectid KGAudioTransCrossFade0dB, SEM <effectcategory>. O par antigo
    ("Constant Power"/KGAudioTransCrossFade) não existe na tabela de tradução do
    Premiere localizado → gerava "Relatório de tradução" (modal) em TODO import,
    apesar de o resultado final ser a mesma Potência Constante.
    """
    half_l, half_r = n // 2, n - n // 2
    return (f"<transitionitem>{rate}<start>{cut_f - half_l}</start><end>{cut_f + half_r}</end>"
            f"<alignment>center</alignment>"
            f"<effect><name>Cross Fade ( 0dB)</name><effectid>KGAudioTransCrossFade0dB</effectid>"
            f"<effecttype>transition</effecttype>"
            f"<mediatype>audio</mediatype><wipecode>0</wipecode><wipeaccuracy>100</wipeaccuracy>"
            f"<startratio>0</startratio><endratio>1</endratio><reverse>FALSE</reverse>"
            f"</effect></transitionitem>")


def speed_xml(speed: float, mediatype: str) -> str:
    """Filtro Time Remap de velocidade constante (speed em %, 100 = normal)."""
    return (f"<filter><effect><name>Time Remap</name><effectid>timeremap</effectid>"
            f"<effectcategory>motion</effectcategory><effecttype>motion</effecttype>"
            f"<mediatype>{mediatype}</mediatype>"
            f"<parameter><parameterid>variablespeed</parameterid><name>variablespeed</name>"
            f"<valuemin>0</valuemin><valuemax>1</valuemax><value>0</value></parameter>"
            f"<parameter><parameterid>speed</parameterid><name>speed</name>"
            f"<valuemin>-10000</valuemin><valuemax>10000</valuemax>"
            f"<value>{speed:g}</value></parameter>"
            f"<parameter><parameterid>reverse</parameterid><name>reverse</name>"
            f"<value>FALSE</value></parameter>"
            f"<parameter><parameterid>frameblending</parameterid><name>frameblending</name>"
            f"<value>FALSE</value></parameter>"
            f"</effect></filter>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cuts_json")
    ap.add_argument("-o", "--output", default=None)
    ap.add_argument("--audio-xfade", type=int, default=0, metavar="N",
                    help="crossfade de áudio (frames) nas junções internas de A1; 0=off")
    args = ap.parse_args()
    if args.audio_xfade < 0:
        die("--audio-xfade não pode ser negativo")

    cpath = Path(args.cuts_json).expanduser()
    if not cpath.is_file():
        die(f"não existe: {cpath}")
    cuts = json.loads(cpath.read_text(encoding="utf-8"))
    base_path = Path(cuts["base"]["file"]).expanduser()
    if not base_path.is_file():
        die(f"master base não existe: {base_path}")
    segments = cuts["base"]["segments"]
    if not segments:
        die("cuts sem segments")
    overlays = cuts.get("overlays", [])
    vo = cuts.get("vo", [])
    base_audio = cuts.get("base_audio", "on")
    if base_audio not in ("on", "muted", "off"):
        die(f'base_audio inválido: {base_audio!r} (use "on", "muted" ou "off")')
    name = cuts.get("sequence_name") or f"{base_path.stem} — IA cut"

    info = probe(base_path)
    fps = info["fps"]
    width = int(cuts.get("width", info["width"]))
    height = int(cuts.get("height", info["height"]))
    rate = rate_xml(fps)

    def fr(t):  # segundos → frames do timebase (frame-accurate no fps real)
        return round(float(t) * fps)

    files, file_defs = {}, []
    def fid_for(p: Path):
        key = str(p)
        if key not in files:
            files[key] = f"file-{len(files) + 1}"
            file_defs.append((files[key], p, probe(p) if p != base_path else info))
        return files[key]

    base_fid = fid_for(base_path)

    # --- V1 + A1: segments do base emendados ---
    xfade = args.audio_xfade
    half_l, half_r = xfade // 2, xfade - xfade // 2
    base_dur_f = int(info["duration"] * fps)
    v1, a1, tl, xfades = [], [], 0, 0
    emitted = set()  # fids que já tiveram <file> completo emitido
    prev = None  # (s_out, dur) do último segment emendado — p/ checar handles do xfade
    for i, seg in enumerate(segments):
        s_in, s_out = fr(seg["in"]), fr(seg["out"])
        if s_out <= s_in:
            continue
        speed = float(seg.get("speed", 100))
        if speed <= 0:
            die(f"speed inválido no segment {i}: {speed}")
        # arquivo próprio do segment (default: o base) — permite trecho pré-renderizado
        if "file" in seg:
            seg_path = Path(seg["file"]).expanduser()
            if not seg_path.is_file():
                die(f"file do segment {i} não existe: {seg_path}")
        else:
            seg_path = base_path
        seg_fid = fid_for(seg_path)
        seg_info = info if seg_path == base_path else probe(seg_path)
        seg_audio = bool(seg.get("audio", seg_path == base_path))
        # duração NA TIMELINE encolhe com a aceleração; o trecho no source é o mesmo
        dur = max(1, int(round((s_out - s_in) * 100.0 / speed)))
        start, end = tl, tl + dur
        # xfade de áudio na junção interna: só se ambos os lados têm handle no source
        if xfade and prev is not None and base_audio != "off" and seg_audio:
            p_out, p_dur = prev
            if (s_in - half_l >= 0 and p_out + half_r <= base_dur_f
                    and dur >= xfade and p_dur >= xfade):
                a1.append(xfade_xml(start, xfade, rate))
                xfades += 1
        if seg_fid in emitted:
            fdef = f'<file id="{seg_fid}"/>'
        else:
            fdef = file_xml(seg_fid, seg_path, seg_info, rate)
            emitted.add(seg_fid)
        a1_enabled = "FALSE" if base_audio == "muted" else "TRUE"
        common = (f"{rate}<start>{start}</start><end>{end}</end>"
                  f"<in>{s_in}</in><out>{s_out}</out>")
        spd_v = "" if speed == 100 else speed_xml(speed, "video")
        spd_a = "" if speed == 100 else speed_xml(speed, "audio")
        v1.append(f'<clipitem id="v1-{i}"><name>{escape(seg_path.name)}</name>'
                  f"<enabled>TRUE</enabled>{common}{fdef}{spd_v}</clipitem>")
        if seg_audio:
            a1.append(f'<clipitem id="a1-{i}"><name>{escape(seg_path.name)}</name>'
                      f"<enabled>{a1_enabled}</enabled>{common}"
                      f'<file id="{seg_fid}"/>'
                      f"<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>"
                      f"{spd_a}</clipitem>")
        tl = end
        # segment sem áudio quebra a cadeia de xfade (não há clipitem em A1 pra cruzar)
        prev = (s_out, dur) if seg_audio else None

    # --- V2: overlays em tempo de timeline ---
    v2 = []
    for i, ov in enumerate(overlays):
        p = Path(ov["file"]).expanduser()
        if not p.is_file():
            die(f"overlay não existe: {p}")
        fid = fid_for(p)
        start = fr(ov["tl_start"])
        dur = fr(ov["dur"])
        s_in = fr(ov["src_in"])
        # def completa do file na primeira clipitem que o usa; depois só referência
        used_before = any(f'file id="{fid}"' in c for c in v1 + v2)
        oinfo = next(inf for f, _, inf in file_defs if f == fid)
        fdef = f'<file id="{fid}"/>' if used_before else file_xml(fid, p, oinfo, rate)
        v2.append(f'<clipitem id="v2-{i}"><name>{escape(p.name)}</name><enabled>TRUE</enabled>{rate}'
                  f"<start>{start}</start><end>{start + dur}</end>"
                  f"<in>{s_in}</in><out>{s_in + dur}</out>{fdef}</clipitem>")

    total = tl
    v2_track = f"<track>{''.join(v2)}<enabled>TRUE</enabled><locked>FALSE</locked></track>" if v2 else ""

    # --- A2: voice-over — um clipitem por arquivo, duração = duração do áudio ---
    a2 = []
    if vo:
        vo_items = []
        for v in vo:
            p = Path(v["file"]).expanduser()
            if not p.is_file():
                die(f"vo não existe: {p}")
            vo_items.append((p, fr(v["tl_start"]), int(audio_probe(p) * fps)))
        for i, (p, start, dur_f) in enumerate(vo_items):
            end = start + dur_f
            if i + 1 < len(vo_items) and end > vo_items[i + 1][1]:
                nxt_p, nxt_start, _ = vo_items[i + 1]
                print(f"AVISO: vo[{i}] ({p.name}) termina no frame {end} e sobrepõe o próximo "
                      f"VO ({nxt_p.name}, frame {nxt_start}) — pulado")
                continue
            key = str(p)
            if key in files:
                fdef = f'<file id="{files[key]}"/>'
            else:
                files[key] = f"file-{len(files) + 1}"
                fdef = audio_file_xml(files[key], p, dur_f, rate)
            a2.append(f'<clipitem id="a2-{i}"><name>{escape(p.name)}</name><enabled>TRUE</enabled>{rate}'
                      f"<start>{start}</start><end>{end}</end>"
                      f"<in>0</in><out>{dur_f}</out>{fdef}"
                      f"<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>"
                      f"</clipitem>")

    # --- A3: música — arquivo contínuo de tl_start até o fim da timeline/arquivo ---
    music = cuts.get("music")
    music_track = ""
    if music:
        mpath = Path(music["file"]).expanduser()
        if not mpath.is_file():
            die(f"music não existe: {mpath}")
        m_start = fr(music.get("tl_start", 0.0))
        if not 0 <= m_start < total:
            die(f"music tl_start ({music.get('tl_start')}s) fora da timeline (0–{total / float(fps):.1f}s)")
        m_dur_f = int(audio_probe(mpath) * fps)
        m_fid = files.get(str(mpath)) or "file-music"
        m_end = min(total, m_start + m_dur_f)
        m_fdef = (f'<file id="{m_fid}"/>' if str(mpath) in files
                  else audio_file_xml(m_fid, mpath, m_dur_f, rate))
        m_clip = (f'<clipitem id="a3-0"><name>{escape(mpath.name)}</name><enabled>TRUE</enabled>{rate}'
                  f"<start>{m_start}</start><end>{m_end}</end>"
                  f"<in>0</in><out>{m_end - m_start}</out>{m_fdef}"
                  f"<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>"
                  f"</clipitem>")
        music_track = f"<track>{m_clip}<enabled>TRUE</enabled><locked>FALSE</locked></track>"

    # --- montagem: A1 (base, salvo "off"), A2 (VO; vazia se só music), A3 (music) ---
    if a2:
        a2_track = f"<track>{''.join(a2)}<enabled>TRUE</enabled><locked>FALSE</locked></track>"
    elif music:
        a2_track = "<track><enabled>TRUE</enabled><locked>FALSE</locked></track>"
    else:
        a2_track = ""
    a1_track = ("" if base_audio == "off"
                else f"<track>{''.join(a1)}<enabled>TRUE</enabled><locked>FALSE</locked></track>\n")
    audio_tracks = f"{a1_track}{a2_track}{music_track}"
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>{escape(name)}</name>
<duration>{total}</duration>
{rate}
<media>
<video>
<format><samplecharacteristics>{rate}<width>{width}</width><height>{height}</height>
<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>
<fielddominance>none</fielddominance></samplecharacteristics></format>
<track>{''.join(v1)}<enabled>TRUE</enabled><locked>FALSE</locked></track>
{v2_track}
</video>
<audio>
<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
{audio_tracks}
</audio>
</media>
</sequence>
</xmeml>
"""
    out = Path(args.output) if args.output else cpath.with_suffix(".xml")
    out.write_text(xml, encoding="utf-8")
    secs = total / float(fps)
    extras = ((f", {xfades} xfades de áudio ({xfade}f)" if xfade else "")
              + (f", {len(a2)} VO em A2" if a2 else "")
              + (", música em A3" if music else "")
              + (f", base_audio={base_audio}" if base_audio != "on" else ""))
    print(f"sequência '{name}': {len(v1)} segments no base, {len(v2)} overlays, {secs:.1f}s{extras}")
    print(f"XMEML={out}  SEGMENTS={len(v1)}  OVERLAYS={len(v2)}  DURATION={secs:.1f}"
          f"  XFADES={xfades}  MUSIC={1 if music else 0}  VO={len(a2)}  BASE_AUDIO={base_audio}")


if __name__ == "__main__":
    main()
