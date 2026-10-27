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

# Who each module needs, for the route table (the doc's route is a chart, not text).
WHO = {1: 'solo', 2: 'solo or pairs', 3: 'solo or pairs', 4: 'solo', 5: 'best with a crew',
       6: 'solo', 7: 'solo', 8: 'optional; your laptop and a phone', 9: 'optional; a phone'}

# The route as a trail: three stages, nine stops, then the finish. Stop: (module, x, y, name, note).
TOP, BOT = 170, 350
STOPS = [(1, 90, TOP, 'First look', 'the demo'), (2, 235, TOP, 'First radio call', 'solo or pairs'),
         (3, 380, TOP, 'Where exactly?', 'six location formats'), (4, 525, TOP, 'Set up', 'starting a mission'),
         (5, 670, TOP, 'Run the net', 'all hands on deck'), (6, 670, BOT, 'Lights out', 'no Internet'),
         (7, 525, BOT, 'After the mission', 'forms, AAR and backups'), (8, 380, BOT, 'The Board', 'two devices'),
         (9, 235, BOT, 'Field phones', 'two devices')]
STAGES = [(24, 96, 432, 154, '1 · Explore the demo'), (462, 96, 274, 330, '2 · Run your own exercise'),
          (164, 276, 292, 150, '3 · Optional extras')]


def route_svg():
    out = ['<div class="scroll"><svg class="trail" viewBox="0 0 760 436" role="img" '
           'aria-label="The route: explore the demo (modules 1 to 3), run your own exercise (4 to 7), '
           'optional extras (8 and 9), then tell us what you found">']
    for x, y, w, h, label in STAGES:
        out.append(f'<rect class="stage" x="{x}" y="{y}" width="{w}" height="{h}" rx="10"/>'
                   f'<text class="slabel" x="{x + 14}" y="{y + 22}">{label}</text>')
    out.append(f'<path class="path" d="M114 {TOP}H211M259 {TOP}H356M404 {TOP}H501M549 {TOP}H646'
               f'M692 {TOP}C748 {TOP} 748 {BOT} 692 {BOT}M646 {BOT}H549M501 {BOT}H404M356 {BOT}H259'
               f'M211 {BOT}H122"/>')
    for n, x, y, name, note in STOPS:
        cls = 'stop main' if n == 5 else 'stop opt' if n >= 8 else 'stop'
        out.append(f'<a href="#m{n}"><circle class="{cls}" cx="{x}" cy="{y}" r="22"/>'
                   f'<text class="num" x="{x}" y="{y + 5}">{n}</text>'
                   f'<text class="name" x="{x}" y="{y + 44}">{name}</text>'
                   f'<text class="note" x="{x}" y="{y + 60}">{note}</text></a>')
    out.append(f'<a href="#telling-us"><path class="flag" d="M92 {BOT + 18}V{BOT - 22}l20 8-20 8"/>'
               f'<text class="name" x="96" y="{BOT + 44}">Tell us</text>'
               f'<text class="note" x="96" y="{BOT + 60}">what you found</text></a>')
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
                else:
                    out.append(f'<h2>{text}</h2>')
                continue
            if text.startswith('<em>Tour v'):
                out.append(f'<p class="ver">{plain(text)}</p>')
            elif text.startswith('<strong>What you need.</strong>'):
                out.append(f'<p id="need">{text}</p>')
            elif text.startswith('<strong>Skills learned:</strong>'):
                out.append(f'<p class="skills">{text}</p>')
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
                boxes.append(f'<div class="box{cls}"><h3>{label}</h3><p>{body}</p></div>')
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
                    lis.append(f'<li id="{iid}" class="{cls}">{spans}<strong>{iid}</strong> {body} '
                               f'<a class="self" href="#{iid}" aria-label="Link to {iid}">#</a></li>')
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

    sheet = ''.join(f'<tr><td><a href="#{x}">{x}</a></td><td>{short(b)}</td><td></td><td></td><td></td></tr>'
                    for x, b in items)
    return body, sheet


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
  <a class="home" href="/"><img src="/assets/icons/rangertrak-mark.svg" alt="" width="28" height="28"> RangerTrak</a>
  <nav><a href="#route">Route</a> <a href="#telling-us">Telling us</a> <a href="#sheet">Tour Checklist</a></nav>
</header>
<main>
'''

TAIL = '''<section id="sheet">
<h2>Tour Checklist</h2>
<p class="noprint">Every test and question in one list. <button type="button" onclick="document.body.classList.add('sheet-only');addEventListener('afterprint',()=>document.body.classList.remove('sheet-only'),{once:true});setTimeout(print,50)">Print the Tour Checklist</button></p>
<p class="fields">Name ____________________ &nbsp; Date __________ &nbsp; Device and browser ____________________ &nbsp; RangerTrak version __________</p>
<div class="scroll"><table class="sheet"><tr><th>ID</th><th>Step</th><th>Pass</th><th>Fail</th><th>Note</th></tr>
{rows}</table></div>
</section>
</main>
<footer><a href="/">Open RangerTrak</a> · <a href="https://rangertrak.com/">rangertrak.com</a> · Free software under the GNU AGPL v3 or later</footer>
</body>
</html>
'''

if __name__ == '__main__':
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else 'tools/tour/index.html'
    body, rows = build(load(src))
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(HEAD + body + '\n' + TAIL.replace('{rows}', rows))
    print('wrote', dst)
