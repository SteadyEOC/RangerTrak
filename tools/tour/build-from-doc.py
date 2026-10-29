# SPDX-License-Identifier: AGPL-3.0-or-later
"""Builds tools/tour/index.html from the Tour Guide doc (the Claude Doc John edits).

    python -I tools/tour/build-from-doc.py <doc-export> [tools/tour/index.html]

<doc-export> is the doc's "The tour" tab as read through the Claude Docs tools: either the raw
<doc ...> XML or the saved JSON read result that wraps it. The doc is the draft; this page is what
testers see. Item IDs (T3.4, Q5.2) and anchors (#m1-#m9, #need, #route, #telling-us, #sheet) are
frozen: retire an ID, never reuse or renumber it.
"""
import html
import json
import re
import sys
import xml.etree.ElementTree as ET

ID_RE = re.compile(r'^([TQ]\d+\.\d+)\b')

# Module icons: 24px line drawings in the accent colour, one per module.
ICONS = {
    1: '<circle cx="6.5" cy="15.5" r="3.5"/><circle cx="17.5" cy="15.5" r="3.5"/><path d="M10 15.5h4M5 12l2-7h3l1 5M19 12l-2-7h-3l-1 5"/>',
    2: '<rect x="7" y="7" width="10" height="15" rx="2"/><path d="M9 7V2M10 11h4M10 14h4M10 17h4"/>',
    3: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    4: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M8.5 10h7M8.5 14h7M8.5 18h4"/>',
    5: '<path d="M12 10v12M8.5 22h7"/><circle cx="12" cy="8" r="2"/><path d="M7.8 3.8a6 6 0 0 0 0 8.4M16.2 3.8a6 6 0 0 1 0 8.4M5 1.5a9.5 9.5 0 0 0 0 13M19 1.5a9.5 9.5 0 0 1 0 13"/>',
    6: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    7: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 11h6M9 14h6M9 17h4"/>',
    8: '<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M8 21h8M12 17v4M6 9h5M6 12h8"/>',
    9: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
}
SVG = ('<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" '
       'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{}</svg>')

# Small icons for the module boxes, the tabs and the question marker (E-244), same line style.
GLYPHS = {
    'Setup': '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/>'
             '<circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    'Goals': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    'Situation': '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    'skills': '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    'q': '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
    'start': '<path d="M5 22V3M5 4h12l-2.5 4L17 12H5"/>',
    'modules': '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/>'
               '<circle cx="4.5" cy="18" r="1.2"/>',
    'tell': '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9h8M8 12h5"/>',
    'sheet': '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M8.5 12l2 2 4-4"/>',
    'print': '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
    'search': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
}


def glyph(name, size=18):
    return SVG.replace('width="22" height="22"', f'width="{size}" height="{size}" aria-hidden="true"').format(GLYPHS[name])

# Who each module needs, for the route table (the doc's route is a chart, not text).
WHO = {1: 'solo', 2: 'solo or pairs', 3: 'solo or pairs', 4: 'solo', 5: 'best with a crew',
       6: 'solo', 7: 'solo', 8: 'optional; your laptop and a phone', 9: 'optional; a phone'}

# The route as a trail that zig-zags down three tiers, one per stage: 1-3 left to right, 4-7 right
# to left, then 8-9 and the finish left to right. Stop: (module, x, y, name, note).
R1, R2, R3 = 104, 300, 496
L, M2, M3, R = 150, 303, 457, 610
STOPS = [(1, L, R1, 'First look', 'the demo'), (2, 380, R1, 'First radio call', 'solo or pairs'),
         (3, R, R1, 'Where exactly?', 'six location formats'), (4, R, R2, 'Set up', 'starting a mission'),
         (5, M3, R2, 'Run the net', 'all hands on deck'), (6, M2, R2, 'Lights out', 'no Internet'),
         (7, L, R2, 'After the mission', 'forms, AAR and backups'), (8, L, R3, 'The Board', 'two devices'),
         (9, 380, R3, 'Field phones', 'two devices')]
STAGES = [(56, R1 - 80, 648, 172, '1 · Explore the demo'), (56, R2 - 80, 648, 172, '2 · Run your own exercise'),
          (56, R3 - 80, 424, 172, '3 · Optional extras')]


def route_svg():
    out = ['<div class="scroll"><svg class="trail" viewBox="0 0 760 612" role="img" '
           'aria-label="The route: explore the demo (modules 1 to 3), run your own exercise (4 to 7), '
           'optional extras (8 and 9), then tell us what you found">']
    for x, y, w, h, label in STAGES:
        out.append(f'<rect class="stage" x="{x}" y="{y}" width="{w}" height="{h}" rx="10"/>'
                   f'<text class="slabel" x="{x + 14}" y="{y + 24}">{label}</text>')
    out.append(f'<path class="path" d="M{L + 26} {R1}H354M406 {R1}H{R - 26}'
               f'M{R + 26} {R1}C760 {R1} 760 {R2} {R + 26} {R2}'
               f'M{R - 26} {R2}H{M3 + 26}M{M3 - 26} {R2}H{M2 + 26}M{M2 - 26} {R2}H{L + 26}'
               f'M{L - 26} {R2}C0 {R2} 0 {R3} {L - 26} {R3}'
               f'M{L + 26} {R3}H354M406 {R3}H{R - 18}"/>')
    for n, x, y, name, note in STOPS:
        cls = 'stop main' if n == 5 else 'stop opt' if n >= 8 else 'stop'
        out.append(f'<a href="#m{n}"><circle class="{cls}" cx="{x}" cy="{y}" r="24"/>'
                   f'<text class="num" x="{x}" y="{y + 6}">{n}</text>'
                   f'<text class="name" x="{x}" y="{y + 50}">{name}</text>'
                   f'<text class="note" x="{x}" y="{y + 70}">{note}</text></a>')
    out.append(f'<a href="#telling-us"><path class="flag" d="M{R - 6} {R3 + 20}V{R3 - 24}l22 9-22 9"/>'
               f'<text class="name" x="{R}" y="{R3 + 50}">Tell us</text>'
               f'<text class="note" x="{R}" y="{R3 + 70}">what you found</text></a>')
    out.append('</svg></div>')
    return ''.join(out)


# Links the doc does not carry: (exact text as it appears in the page, href). First match only.
LINKS = [
    ('<strong>rangertrak.com</strong>', 'https://rangertrak.com/'),
    ('<em>Field Guide</em>', 'https://rangertrak.com/field-guide.html'),
    ('go to rangertrak.org', '/'),
    ('RangerTrak@steadyeoc.com', 'mailto:RangerTrak@steadyeoc.com?subject=Tour'),
    ('rangertrak.com/full-view.html', 'https://rangertrak.com/full-view.html'),
    ('github.com/SteadyEOC/RangerTrak/issues', 'https://github.com/SteadyEOC/RangerTrak/issues'),
]


def load(path):
    s = open(path, encoding='utf-8').read()
    if not s.lstrip().startswith('<doc'):
        t = ''.join(x['text'] for x in json.loads(s))
        s = json.loads(t[t.index('{"verdict"'):])['data']['xml']
    return ET.fromstring(s)


def curly(s):
    return re.sub(r"(?<=\w)'|'(?=s\b)", '’', s)


def inline(p):
    """A paragraph's runs as HTML, merging neighbouring runs that share marks."""
    runs = []
    for c in p:
        if c.tag == 'text':
            marks = tuple(m for m in ('bold', 'italic', 'code') if c.find(m) is not None)
            runs.append((marks, ''.join(c.itertext())))
        elif c.tag == 'mention':
            runs.append((('mention',), c.get('label') or ''))
    merged = []
    for m, t in runs:
        if merged and merged[-1][0] == m:
            merged[-1] = (m, merged[-1][1] + t)
        else:
            merged.append((m, t))
    out = ''
    for m, t in merged:
        lead = t[:len(t) - len(t.lstrip())]
        trail = t[len(t.rstrip()):]
        body = html.escape(curly(t.strip()), quote=False).replace('"', '&quot;')
        if not body:
            out += t
            continue
        if 'mention' in m:
            body = '<a href="#sheet">Tour Checklist</a>'
        if 'code' in m:
            body = f'<code>{body}</code>'
        if 'italic' in m:
            body = f'<em>{body}</em>'
        if 'bold' in m:
            body = f'<strong>{body}</strong>'
        out += lead + body + trail
    return re.sub(r'  +', ' ', out).strip()


def plain(h):
    return html.unescape(re.sub(r'<[^>]+>', '', h))


def short(h):
    t = plain(h)
    t = t if len(t) <= 90 else t[:90].rstrip() + '…'
    return html.escape(t, quote=False)


def build(root):
    out, items, cards = [], [], {}
    blocks = list(root)
    module = 0
    i = 0
    while i < len(blocks):
        b = blocks[i]
        i += 1
        t = b.tag
        if t == 'paragraph':
            h = b.get('heading')
            text = inline(b)
            if not text or b.find('date') is not None:
                continue
            if h == '1':
                continue
            if h == '3':
                out.append(f'<h3>{text}</h3>')
                continue
            if h == '2':
                title = plain(text)
                m = re.match(r'Module (\d+) — (.*)', title)
                if m:
                    module = int(m.group(1))
                    out.append(f'<!--view:m{module}-->')
                    out.append(f'<h2 id="m{module}" class="mod"><span class="icon" aria-hidden="true">'
                               f'{SVG.format(ICONS[module])}</span><span><span class="mnum">Module {module}</span> '
                               f'{html.escape(m.group(2), quote=False)}</span></h2>')
                elif title.endswith('RangerTrak Tour'):
                    out.append('<h1>RangerTrak Tour Guide</h1>')
                elif title == 'The route':
                    rows = ''.join(f'<tr><td><a href="#m{n}">{n}</a></td><td><a href="#m{n}">{{m{n}}}</a></td>'
                                   f'<td>{WHO[n]}</td></tr>' for n in range(1, 10))
                    out.append('<h2 id="route">The route</h2>\n' + route_svg() + '\n<div class="scroll"><table class="route">'
                               f'<tr><th>Module</th><th>What</th><th>Who</th></tr>{rows}</table></div>')
                elif title.startswith('Telling us'):
                    out.append(f'<h2 id="telling-us">{html.escape(title, quote=False)}</h2>')
                elif title == 'Last stop':
                    out.append('<!--view:finish-->')
                    out.append(f'<h2 id="last-stop">{text}</h2>')
                else:
                    out.append(f'<h2>{text}</h2>')
                continue
            if text.startswith('<em>Tour v'):
                out.append(f'<p class="ver">{plain(text)}</p>')
            elif text.startswith('<strong>What you need.</strong>'):
                out.append(f'<p id="need">{text}</p>')
            elif text.startswith('<strong>Skills learned:</strong>'):
                out.append(f'<p class="skills">{glyph("skills")} <span>{text}</span></p>')
            else:
                out.append(f'<p>{text}</p>')
        elif t == 'blockquote':
            boxes = []
            for p in b:
                text = inline(p)
                m = re.match(r'<strong>(\w+):</strong>\s*(.*)', text)
                if not m:
                    continue
                label, body = m.group(1), m.group(2)
                body = body[:1].upper() + body[1:]
                cls = ' sit' if label == 'Situation' else ''
                icon = glyph(label, 16) if label in GLYPHS else ''
                boxes.append(f'<div class="box{cls}"><h3>{icon}{label}</h3><p>{body}</p></div>')
            if boxes:
                out.append('<div class="mhead">' + ''.join(boxes) + '</div>')
            else:
                # An aside, not a module's Setup / Goals / Situation.
                paras = ''.join(f'<p>{inline(p)}</p>' for p in b if p.tag == 'paragraph' and inline(p))
                out.append(f'<blockquote>{paras}</blockquote>')
        elif t == 'list':
            check = b.get('kind') == 'check'
            lis = []
            prev = ''
            for li in b:
                p = li.find('paragraph')
                text = inline(p) if p is not None else ''
                if not text:
                    continue
                m = ID_RE.match(plain(text))
                if check and m:
                    iid = m.group(1)
                    body = re.sub(r'^(<strong>)?' + re.escape(iid) + r'(</strong>)?\s*', '', text)
                    body = body.replace('<em>Op</em><em>tional.</em>', '<em>Optional.</em>')
                    spans = ''
                    ids = [iid]
                    rng = re.match(r'(?:<strong>)?to(?:</strong>)?\s*<strong>([TQ]\d+)\.(\d+)</strong>', body)
                    if rng:
                        stem, last = rng.group(1), int(rng.group(2))
                        first = int(iid.split('.')[1])
                        ids = [f'{stem}.{n}' for n in range(first, last + 1)]
                        spans = ''.join(f'<span id="{x}"></span>' for x in ids[1:])
                        # The checklist names each card, or six rows would read the same (E-225).
                        for x in ids:
                            card = 'C' + x[1:]
                            fmt = f', {cards[card]},' if card in cards else ''
                            items.append((x, f'{card}{fmt} lands where the card table’s last column says.'))
                    else:
                        items.append((iid, body))
                    cls = 'q' if iid[0] == 'Q' else 't'
                    # A gap between a module's tests and its questions.
                    if cls == 'q' and prev == 't':
                        cls = 'q first'
                    prev = cls[0]
                    # A tick box per step (E-244); a range item ticks every ID it covers.
                    what = 'Answered' if cls[0] == 'q' else 'Done'
                    tick = (f'<input type="checkbox" class="tick" data-ids="{" ".join(ids)}" '
                            f'aria-label="{what}: {iid}">')
                    mark = glyph('q', 15) if cls[0] == 'q' else ''
                    lis.append(f'<li id="{iid}" class="{cls}">{spans}{tick}<div><strong>{mark}{iid}</strong> {body} '
                               f'<a class="self" href="#{iid}" aria-label="Link to {iid}">#</a></div></li>')
                else:
                    lis.append(f'<li>{text}</li>')
            out.append(('<ul class="checks">' if check else '<ul>') + ''.join(lis) + '</ul>')
        elif t == 'table':
            rows = []
            for r_i, r in enumerate(b):
                tag = 'th' if r_i == 0 else 'td'
                cells = ''.join(f'<{tag}>{inline(c.find("paragraph")) if c.find("paragraph") is not None else ""}</{tag}>'
                                for c in r)
                rows.append(f'<tr>{cells}</tr>')
                texts = [plain(inline(c.find('paragraph'))) if c.find('paragraph') is not None else '' for c in r]
                if r_i and len(texts) > 1 and re.fullmatch(r'C\d+\.\d+', texts[0]):
                    cards[texts[0]] = texts[1]
            out.append('<div class="scroll"><table>' + ''.join(rows) + '</table></div>')
        elif t == 'codeBlock':
            out.append('<pre>' + html.escape(''.join(b.itertext()), quote=False) + '</pre>')
    body = '\n'.join(out)

    titles = dict(re.findall(r'<span class="mnum">Module (\d+)</span> ([^<]*)</span>', body))
    for n, title in titles.items():
        body = body.replace('{m' + n + '}', title)
    for text, href in LINKS:
        body = body.replace(text, f'<a href="{href}">{text}</a>', 1)
    tests = len([x for x, _ in items if x[0] == 'T'])
    questions = len(items) - tests
    body = re.sub(r'The tour has \d+ tests and \d+ questions',
                  f'The tour has {tests} tests and {questions} questions', body)
    # A whole item set bold in the doc's "Telling us" table: only the button name is bold.
    body = body.replace('<strong>Review and send. It becomes a public GitHub issue, so keep real names and mission data out</strong>',
                        '<strong>Review and send</strong>. It becomes a public GitHub issue, so keep real names and mission data out')

    # One view per tab and per module (E-244): tour.js shows one at a time; without it, or when
    # printing the whole tour, they read as the old long page.
    names = {n: titles[str(n)] for n in range(1, 10)}
    views = re.split(r'<!--view:(\w+)-->\n?', body)
    html_views = [f'<section class="view" id="start">{views[0]}<p class="noprint">'
                  f'<button type="button" id="print-all">{glyph("print", 16)} Print the whole tour</button> '
                  '<a class="next" href="#m1">Start with module 1 →</a></p></section>']
    for key, content in zip(views[1::2], views[2::2]):
        if key.startswith('m'):
            n = int(key[1:])
            prev = (f'<a href="#m{n - 1}">← {n - 1} · {names[n - 1]}</a>' if n > 1
                    else '<a href="#start">← Start</a>')
            nxt = (f'<a class="next" href="#m{n + 1}">{n + 1} · {names[n + 1]} →</a>' if n < 9
                   else '<a class="next" href="#last-stop">Last stop →</a>')
            content = content.replace('</h2>', f'</h2>\n<p class="mprog" data-m="{n}"></p>', 1)
            html_views.append(f'<section class="view" data-view="{key}">{content}'
                              f'<nav class="pager" aria-label="Modules">{prev}{nxt}</nav></section>')
        else:
            html_views.append(f'<section class="view" id="{key}">{content}</section>')
    body = '\n'.join(html_views)

    side = ''.join(f'<li><a href="#m{n}" data-m="{n}"><span class="icon">{SVG.format(ICONS[n])}</span>'
                   f'<span class="t"><span class="mnum">Module {n}</span>{names[n]}</span>'
                   f'<span class="count"></span></a></li>' for n in range(1, 10))
    side = f'<nav class="side" aria-label="Modules"><ol>{side}</ol></nav>'

    rows, last = [], None
    for x, b in items:
        m = int(x[1:].split('.')[0])
        if m != last:
            label = f'Module {m} · {names[m]}' if m in names else 'Last stop'
            rows.append(f'<tr class="grp"><th colspan="6">{label}</th></tr>')
            last = m
        rows.append(f'<tr><td><input type="checkbox" class="tick" data-ids="{x}" aria-label="Done: {x}"></td>'
                    f'<td><a href="#{x}">{x}</a></td><td>{short(b)}</td><td></td><td></td><td></td></tr>')
    return body, ''.join(rows), side, len(items)


# The brand mark as the app's navbar draws it: currentColor, so it shows on the dark bar.
MARK = ('<svg class="mark" width="16" height="27" viewBox="0 0 155 260" aria-hidden="true">'
        '<g fill="none" stroke="currentColor" stroke-linejoin="round">'
        '<path d="M 52 239 L 18.4 175.8 A 38 38 0 1 1 85.6 175.8 Z" stroke-width="12"/>'
        '<path d="M 52 96 L 52 150" stroke-width="5" stroke-linecap="round"/></g>'
        '<rect x="44" y="142" width="16" height="58" rx="6" fill="currentColor"/>'
        '<circle cx="52" cy="88" r="8" fill="currentColor"/>'
        '<g class="waves" fill="none" stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke">'
        '<path transform="translate(52,88) scale(0.80) translate(-52,-88)" d="M 74.94 55.23 A 40 40 0 0 1 82.64 113.71"/>'
        '<path transform="translate(52,88) scale(1.30) translate(-52,-88)" d="M 74.94 55.23 A 40 40 0 0 1 82.64 113.71"/>'
        '<path transform="translate(52,88) scale(1.85) translate(-52,-88)" d="M 74.94 55.23 A 40 40 0 0 1 82.64 113.71"/>'
        '</g></svg>')

# The app's own pages, as its navbar lists them, so a tester can jump back from any step.
APP_LINKS = [('/', 'Entry'), ('/map', 'Map'), ('/radio-log', 'Radio Log'), ('/messages', 'Messages'),
             ('/rangers', 'Rangers'), ('/mission', 'Mission'), ('/after-action', 'After action'), ('/help', 'Help')]

HEAD = '''<!doctype html>
<!-- SPDX-License-Identifier: AGPL-3.0-or-later
     RangerTrak Tour Guide, for beta testers. Free software under the GNU AGPL v3 or later.
     Built by build-from-doc.py from the Tour Guide doc; edit the doc, then rebuild.
     Item IDs (T3.4, Q5.2) and anchors (#m1-#m9, #need, #route, #telling-us, #sheet) are frozen:
     testers and the rangertrak.com beta post quote them. Retire an ID; never reuse or renumber. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>RangerTrak Tour Guide</title>
<meta name="description" content="A nine-module tour of RangerTrak for beta testers, with numbered tests and questions.">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="tour.css">
</head>
<body>
<header class="top">
  <div class="appbar">
    <a class="home" href="/">{mark}<span>RangerTrak</span></a>
    <nav class="applinks" aria-label="RangerTrak">{applinks}</nav>
    <a class="openapp" href="/">Open the app →</a>
  </div>
  <div class="tabrow">
  <nav class="tabs" aria-label="Tour Guide">
    <a href="#start">{i_start}<span>Start</span></a>
    <a href="#m1" id="tab-modules">{i_modules}<span>Modules</span></a>
    <a href="#last-stop">{i_tell}<span>Telling us</span></a>
    <a href="#sheet">{i_sheet}<span>Checklist</span></a>
    <span class="overall"><span id="done-count">0</span> of {total} done</span>
  </nav>
  <div class="search" role="search" hidden>{i_search}<input type="search" id="tour-q" placeholder="Search the Tour"
    aria-label="Search the Tour" aria-controls="tour-hits" autocomplete="off"></div>
  </div>
  <div class="hits" id="tour-hits" hidden></div>
</header>
<div class="layout">
{side}
<main>
'''

TAIL = '''<section class="view" id="sheet">
<h2>Tour Checklist</h2>
<p class="noprint">Every test and question in one list. Tick boxes here or beside each step: they stay in this browser,
on this device. <button type="button" id="print-sheet">{i_print} Print the Tour Checklist</button>
<button type="button" id="clear-ticks">Clear my ticks</button></p>
<p class="fields">Name ____________________ &nbsp; Date __________ &nbsp; Device and browser ____________________ &nbsp; RangerTrak version __________</p>
<div class="scroll"><table class="sheet"><tr><th>Done</th><th>ID</th><th>Step</th><th>Pass</th><th>Fail</th><th>Note</th></tr>
{rows}</table></div>
</section>
</main>
</div>
<footer><a href="/">Open RangerTrak</a> · <a href="https://rangertrak.com/">rangertrak.com</a> · Free software under the GNU AGPL v3 or later</footer>
<script src="tour.js"></script>
</body>
</html>
'''

if __name__ == '__main__':
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else 'tools/tour/index.html'
    body, rows, side, total = build(load(src))
    head = (HEAD.replace('{mark}', MARK)
            .replace('{applinks}', ''.join(f'<a href="{h}">{t}</a>' for h, t in APP_LINKS))
            .replace('{i_start}', glyph('start')).replace('{i_modules}', glyph('modules'))
            .replace('{i_tell}', glyph('tell')).replace('{i_sheet}', glyph('sheet'))
            .replace('{i_search}', glyph('search'))
            .replace('{total}', str(total)).replace('{side}', side))
    tail = TAIL.replace('{rows}', rows).replace('{i_print}', glyph('print', 16))
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + body + '\n' + tail)
    print('wrote', dst)
