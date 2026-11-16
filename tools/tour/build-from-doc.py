# SPDX-License-Identifier: AGPL-3.0-or-later
"""Builds tools/tour/index.html (the Tour Guide at rangertrak.org/tour/) from tools/tour/tour-source.md.

    py -3 tools/tour/build-from-doc.py tools/tour/tour-source.md [tools/tour/index.html]

The source is a plain text file anyone can edit; its short syntax is documented at the top of the file
itself. index.html is generated and never hand-edited. E-317 (2026-11-15) made the guide three tours
(1: Easy menus, modules 1-7; 2: Full menus, 11-14; 3: RangerView and field phones, 21-22) and
renumbered every ID; the Start page's "Old IDs" table decodes the old ones, and tour.js redirects them.
Item IDs and anchors (#m1.., #need, #route, #tours, #telling-us, #sheet) are frozen again from here on:
retire an ID, never reuse or renumber it.
"""
import html
import math
import re
import sys

# Module icons: 24px line drawings in the accent colour, one per module.
BIKE = ('<circle cx="6.5" cy="15.5" r="3.5"/><circle cx="17.5" cy="15.5" r="3.5"/>'
        '<path d="M10 15.5h4M5 12l2-7h3l1 5M19 12l-2-7h-3l-1 5"/>')
ICONS = {
    1: BIKE,
    2: '<rect x="7" y="7" width="10" height="15" rx="2"/><path d="M9 7V2M10 11h4M10 14h4M10 17h4"/>',
    3: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    4: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M8.5 10h7M8.5 14h7M8.5 18h4"/>',
    5: '<path d="M12 10v12M8.5 22h7"/><circle cx="12" cy="8" r="2"/><path d="M7.8 3.8a6 6 0 0 0 0 8.4M16.2 3.8a6 6 0 0 1 0 8.4M5 1.5a9.5 9.5 0 0 0 0 13M19 1.5a9.5 9.5 0 0 1 0 13"/>',
    6: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    7: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 11h6M9 14h6M9 17h4"/>',
    # Tour 2
    11: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    12: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.5 7.5h13M5.5 16.5h13"/>',
    13: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><path d="M7 11v4M17 11v4M7 15h10M12 15v6"/>',
    14: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 12l2 2 4-4M9 18h6"/>',
    # Tour 3 (the old module 8 and 9 icons)
    21: '<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M8 21h8M12 17v4M6 9h5M6 12h8"/>',
    22: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
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
    'tours': '<path d="M3 20c4-1 5-8 9-8s5 7 9 8"/><circle cx="12" cy="6" r="2"/>',
    'modules': '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/>'
               '<circle cx="4.5" cy="18" r="1.2"/>',
    'tell': '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9h8M8 12h5"/>',
    'sheet': '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M8.5 12l2 2 4-4"/>',
    'print': '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
    'search': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    # a bench for the rest stops, a peak for the viewpoints
    'rest': '<path d="M4 9h16M5 9v6M19 9v6M4 15h16M7 15v4M17 15v4"/>',
    'view': '<path d="M3 20l6-11 4 6 3-4 5 9z"/><circle cx="17" cy="6" r="2"/>',
}


def glyph(name, size=18):
    return SVG.replace('width="22" height="22"', f'width="{size}" height="{size}" aria-hidden="true"').format(GLYPHS[name])


def icon(n):
    return SVG.format(ICONS[n])


# Links the text does not carry: (exact text as it appears in the page, href). First match only.
LINKS = [
    ('<strong>rangertrak.com</strong>', 'https://rangertrak.com/'),
    ('<em>Field Guide</em>', 'https://rangertrak.com/field-guide.html'),
    ('go to rangertrak.org', '/'),
    ('RangerTrak@steadyeoc.com', 'mailto:RangerTrak@steadyeoc.com?subject=Tour'),
    ('rangertrak.com/full-view.html', 'https://rangertrak.com/full-view.html'),
    ('github.com/SteadyEOC/RangerTrak/issues', 'https://github.com/SteadyEOC/RangerTrak/issues'),
]

# The prowords, marked in capitals in call cards.
PROWORDS = ['I SAY AGAIN', 'SAY AGAIN', 'I SPELL', 'WAIT OUT', 'THIS IS', 'AFFIRMATIVE', 'NEGATIVE',
            'CORRECTION', 'INITIALS', 'FIGURES', 'ROGER', 'BREAK', 'WAIT', 'OVER', 'OUT']
PW_RE = re.compile(r'\b(' + '|'.join(PROWORDS) + r')\b')


# ---------------------------------------------------------------------------------------- text

def curly(s):
    return re.sub(r"(?<=\w)'|'(?=s\b)", '’', s)


def inline(text):
    """**bold**, *italic*, `code`, [text](url) and <br> as HTML. Everything else is plain text."""
    t = text.replace('<br>', '\x00')
    t = html.escape(curly(t), quote=False)
    parts = re.split(r'(`[^`]+`)', t)
    out = []
    for p in parts:
        if p.startswith('`') and p.endswith('`') and len(p) > 1:
            out.append('<code>' + p[1:-1] + '</code>')
            continue
        p = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2">\1</a>', p)
        p = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', p)
        p = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<em>\1</em>', p)
        out.append(p)
    return ''.join(out).replace('\x00', '<br>')


def plain(h):
    return html.unescape(re.sub(r'<[^>]+>', '', h))


def short(h):
    t = plain(h)
    t = t if len(t) <= 90 else t[:90].rstrip() + '…'
    return html.escape(t, quote=False)


def mark_prowords(h):
    """Wraps capitalised prowords in text (not inside tags) in <b class="pw">."""
    bits = re.split(r'(<[^>]+>)', h)
    return ''.join(b if b.startswith('<') else PW_RE.sub(r'<b class="pw">\1</b>', b) for b in bits)


def expand_calls(line):
    """{{call Team :: message}} as the four-line exchange every call card uses."""
    def one(m):
        team, msg = m.group(1).strip(), m.group(2).strip()
        return (f'{team}: Village Base, THIS IS {team}, OVER.<br>Base: {team}, Village Base, go ahead, OVER.<br>'
                f'{team}: {msg} OVER.<br>Base: ROGER, OUT.')
    return re.sub(r'\{\{call ([^:{}]+?) :: (.+?)\}\}', one, line)


# ---------------------------------------------------------------------------------------- parse

STEP_RE = re.compile(r'^([TQ]\d+)\.(\d+)(?:-(?:[TQ]?\d+\.)?(\d+))?\s+(.*)$')
BOX_RE = re.compile(r'^(Setup|Goals|Situation):\s*(.*)$')


def parse(path):
    """The source as a dict: start / finish block lists, tours, modules (each a block list) and the old-ID blocks."""
    lines = open(path, encoding='utf-8').read().split('\n')
    doc = {'start': [], 'finish': [], 'tours': {}, 'modules': {}, 'old': {'tour': [], 'advanced': []}}
    cur = doc['start']
    mode = 'start'
    tour = None
    old = None
    i = 0
    while i < len(lines):
        raw = lines[i].rstrip()
        i += 1
        if not raw.strip() or raw.startswith(';;'):
            continue
        if raw.startswith('@old'):
            old = raw.split()[1]
            mode = 'old'
            continue
        if mode == 'old':
            if raw.startswith('@'):
                raise SystemExit(f'unexpected {raw} inside @old')
            a = [x.strip() for x in raw.split('|')]
            doc['old'][old].append((a[0], a[1], a[2] if len(a) > 2 else ''))
            continue
        if raw.startswith('@start'):
            cur, mode = doc['start'], 'start'
            continue
        if raw.startswith('@finish'):
            cur, mode = doc['finish'], 'finish'
            continue
        if raw.startswith('@tour '):
            a = [x.strip() for x in raw[6:].split('|')]
            tour = int(a[0])
            doc['tours'][tour] = {'n': tour, 'title': a[1], 'tag': a[2], 'time': a[3] if len(a) > 3 else '', 'modules': []}
            continue
        if raw.startswith('@module '):
            a = [x.strip() for x in raw[8:].split('|')]
            n = int(a[0])
            m = {'n': n, 'title': a[1], 'who': a[2], 'icon': int(a[3]) if len(a) > 3 and a[3] else n, 'tour': tour, 'blocks': []}
            doc['modules'][n] = m
            doc['tours'][tour]['modules'].append(n)
            cur, mode = m['blocks'], 'module'
            continue
        raw = expand_calls(raw)
        if raw.startswith('@swap '):
            cur.append(('swap', raw[6:].strip()))
        elif raw.startswith('{{') and raw.endswith('}}'):
            cur.append(('placeholder', raw[2:-2].strip()))
        elif raw.startswith('~~~'):
            body = []
            while i < len(lines) and not lines[i].startswith('~~~'):
                body.append(lines[i].rstrip())
                i += 1
            i += 1
            cur.append(('pre', '\n'.join(body)))
        elif raw.startswith('|'):
            rows = [raw]
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(expand_calls(lines[i].rstrip()))
                i += 1
            cells = [[c.strip() for c in r.strip()[1:-1].split('|')] for r in rows]
            cells = [r for k, r in enumerate(cells) if not (k == 1 and all(re.fullmatch(r':?-{3,}:?', c) for c in r))]
            cur.append(('table', cells))
        elif raw.startswith('# '):
            cur.append(('h1', raw[2:]))
        elif raw.startswith('## '):
            cur.append(('h2', raw[3:]))
        elif raw.startswith('### '):
            cur.append(('h3', raw[4:]))
        elif raw.startswith('> '):
            cur.append(('quote', raw[2:]))
        elif raw.startswith('- '):
            cur.append(('li', raw[2:]))
        elif raw.startswith('  ') and cur and cur[-1][0] == 'box':
            cur[-1][2].append(raw.strip())
        elif BOX_RE.match(raw):
            m = BOX_RE.match(raw)
            cur.append(('box', m.group(1), [m.group(2)]))
        elif raw.startswith('Skills:'):
            cur.append(('skills', raw[7:].strip()))
        elif STEP_RE.match(raw):
            m = STEP_RE.match(raw)
            cur.append(('step', m.group(1), int(m.group(2)), int(m.group(3)) if m.group(3) else None, m.group(4)))
        else:
            cur.append(('p', raw))
    return doc


# ---------------------------------------------------------------------------------------- render

_SHOTS = None


def shot_html(iid):
    """E-244: a small picture of the control a step names; made by tools/tour/capture-shots.js (img/shots.json)."""
    global _SHOTS
    if _SHOTS is None:
        import json
        import os
        f = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img', 'shots.json')
        _SHOTS = json.load(open(f, encoding='utf-8')) if os.path.exists(f) else {}
    s = _SHOTS.get(iid)
    if not s:
        return ''
    alt = s['alt'].replace('&', '&amp;').replace('"', '&quot;')
    return (f'<img class="shot" src="img/{s["file"]}" alt="{alt}" width="{s["width"]}" '
            f'height="{s["height"]}" loading="lazy">')


class Ctx:
    def __init__(self):
        self.items = []      # (id, tour, module, body html)
        self.ids = set()
        self.cards = {}      # C12.1 -> its "Should land at" text


REST = ('<aside class="rest noprint-no"><span class="restico" aria-hidden="true">{ico}</span><p><strong>Rest stop.</strong> '
        '{text}</p></aside>')
REST_TEXT = ('Swap seats: everyone moves one seat round, and the new scribe starts the next module. '
             'Stretch, refill the coffee, and compare notes before you go on.')


def rest_html(text=None):
    return REST.format(ico=glyph('rest', 22), text=inline(text) if text else REST_TEXT)


def table_html(cells, ctx):
    head, body = cells[0], cells[1:]
    is_cards = head[0] == 'Card'
    out = []
    for r_i, r in enumerate(cells):
        tag = 'th' if r_i == 0 else 'td'
        tds = []
        for c_i, c in enumerate(r):
            h = inline(c)
            if is_cards and r_i and c_i == 1:
                h = f'<div class="exch">{mark_prowords(h)}</div>'
            tds.append(f'<{tag}>{h}</{tag}>')
        out.append('<tr>' + ''.join(tds) + '</tr>')
        if is_cards and r_i and re.fullmatch(r'C\d+\.\d+', r[0]):
            ctx.cards[r[0]] = plain(inline(r[-1]))
    cls = ' class="cards"' if is_cards else ''
    return f'<div class="scroll"><table{cls}>' + ''.join(out) + '</table></div>'


def blocks_html(blocks, ctx, tour=None, module=None):
    """Blocks as HTML. Boxes gather into one Setup / Goals / Situation header; steps into one checklist."""
    out = []
    boxes = []
    steps = []
    lis = []

    def flush():
        nonlocal boxes, steps, lis
        if boxes:
            out.append('<div class="mhead">' + ''.join(
                f'<div class="box{" sit" if label == "Situation" else ""}"><h3>{glyph(label, 16)}{label}</h3>'
                + ''.join(f'<p>{inline(x)}</p>' for x in paras) + '</div>' for _, label, paras in boxes) + '</div>')
            boxes = []
        if lis:
            out.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in lis) + '</ul>')
            lis = []
        if steps:
            out.append(steps_html(steps, ctx, tour, module))
            steps = []

    for b in blocks:
        k = b[0]
        if k == 'box':
            if steps or lis:
                flush()
            boxes.append(b)
            continue
        if k == 'step':
            if boxes or lis:
                flush()
            steps.append(b)
            continue
        if k == 'li':
            if boxes or steps:
                flush()
            lis.append(b[1])
            continue
        flush()
        if k == 'p':
            t = inline(b[1])
            if t.startswith('<strong>Radio practice.</strong>'):
                out.append(f'<p class="radio">{t}</p>')
            else:
                out.append(f'<p>{t}</p>')
        elif k == 'h1':
            out.append(f'<h1><span class="bikeico" aria-hidden="true">{icon(1)}</span>{inline(b[1])}</h1>')
        elif k == 'h2':
            out.append(f'<h2>{inline(b[1])}</h2>')
        elif k == 'h3':
            out.append(f'<h3>{inline(b[1])}</h3>')
        elif k == 'quote':
            out.append(f'<blockquote><p>{inline(b[1])}</p></blockquote>')
        elif k == 'pre':
            out.append('<pre>' + html.escape(b[1], quote=False) + '</pre>')
        elif k == 'table':
            out.append(table_html(b[1], ctx))
        elif k == 'skills':
            out.append(f'<p class="skills">{glyph("skills")} <span><strong>Skills learned:</strong> {inline(b[1])}</span></p>')
        elif k == 'swap':
            out.append(rest_html(b[1]))
        elif k == 'placeholder':
            out.append('{{' + b[1] + '}}')
        else:
            raise SystemExit(f'unknown block {k}')
    flush()
    return '\n'.join(out)


def steps_html(steps, ctx, tour, module):
    lis = []
    prev = ''
    for _, stem, first, last, text in steps:
        iid = f'{stem}.{first}'
        if iid in ctx.ids:
            raise SystemExit(f'ID {iid} appears twice')
        ids = [iid]
        spans = ''
        body = inline(text)
        if last:
            ids = [f'{stem}.{n}' for n in range(first, last + 1)]
            spans = ''.join(f'<span id="{x}"></span>' for x in ids[1:])
            for x in ids:
                if x in ctx.ids:
                    raise SystemExit(f'ID {x} appears twice')
        for x in ids:
            ctx.ids.add(x)
        if last:
            for x in ids:
                card = 'C' + x[1:]
                where = ctx.cards.get(card, 'where the card table’s last column says')
                ctx.items.append((x, tour, module, f'{card} lands at {where}.'))
        else:
            ctx.items.append((iid, tour, module, body))
        cls = 'q' if stem[0] == 'Q' else 't'
        if cls == 'q' and prev == 't':
            cls = 'q first'
        prev = cls[0]
        what = 'Answered' if cls[0] == 'q' else 'Done'
        tick = (f'<input type="checkbox" class="tick" data-ids="{" ".join(ids)}" aria-label="{what}: {iid}">')
        mark = glyph('q', 15) if cls[0] == 'q' else ''
        lis.append(f'<li id="{iid}" class="{cls}">{spans}{tick}<div><strong>{mark}{iid}</strong> {body} '
                   f'<a class="self" href="#{iid}" aria-label="Link to {iid}">#</a>{shot_html(iid)}</div></li>')
    return '<ul class="checks">' + ''.join(lis) + '</ul>'


# --------------------------------------------------------------------------------------- trail

def _bez(p0, c1, c2, p1, t):
    u = 1 - t
    return (u**3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p1[0],
            u**3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p1[1])


def trail_svg(tour, doc):
    """One tour's route: a path that wanders (flat in Tour 1, rolling in 2, the long way round in 3), a stop per
    module, a bench at each seat swap and a peak where a module has plenty of questions."""
    mods = [doc['modules'][n] for n in doc['tours'][tour]['modules']]
    qcount = {m['n']: sum(1 for b in m['blocks'] if b[0] == 'step' and b[1] == 'Q') for m in mods}
    amp = {1: 16, 2: 40, 3: 56}[tour]
    extra = {1: 0, 2: 1, 3: 3}[tour]
    base = 100
    wob = [0.0, -1.0, 0.8, -0.7, 1.0, -0.9, 0.6, -0.5, 0.9, -1.0, 0.7, -0.6, 0.8, -0.8]
    x0, x1 = 90, 640
    n = len(mods)
    pts, stop_at, k = [(28, base + 4)], [], 0
    seg = (x1 - x0) / (n - 1) if n > 1 else 0
    for i, m in enumerate(mods):
        if i:
            for e in range(1, extra + 1):
                k += 1
                x = x0 + seg * (i - 1) + seg * e / (extra + 1)
                pts.append((x, base + amp * wob[k % len(wob)] * (1.0 if extra else 0)))
        k += 1
        pts.append((x0 + seg * i, base + amp * wob[k % len(wob)] * 0.7))
        stop_at.append(len(pts) - 1)
    pts.append((716, base - 6))
    # Catmull-Rom through every point, as cubic segments
    segs = []
    for j in range(len(pts) - 1):
        p0, p1 = pts[max(j - 1, 0)], pts[j]
        p2, p3 = pts[j + 1], pts[min(j + 2, len(pts) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        segs.append((p1, c1, c2, p2))
    d = f'M{pts[0][0]:.1f} {pts[0][1]:.1f}' + ''.join(
        f'C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}' for _, c1, c2, p2 in segs)
    H = 190 if tour == 3 else 170 if tour == 2 else 140
    shift = {1: -10, 2: 0, 3: 6}[tour]
    label = ', '.join(f'module {m["n"]} {m["title"]}' for m in mods)
    out = [f'<div class="scroll"><svg class="trail" viewBox="0 0 760 {H}" role="img" aria-label="The route of tour {tour}: {label}, '
           f'then tell us what you found. A bench marks each seat swap.">', f'<g transform="translate(0 {shift})">',
           f'<path class="path" d="{d}"/>']
    # a bench at the middle of every stretch between two stops
    for a, b in zip(stop_at, stop_at[1:]):
        samples = []
        for j in range(a, b):
            s = segs[j]
            samples += [_bez(*s, t / 12) for t in range(12)]
        samples.append(pts[b])
        total = sum(math.dist(samples[q], samples[q + 1]) for q in range(len(samples) - 1))
        run, mid = 0.0, samples[0]
        for q in range(len(samples) - 1):
            run += math.dist(samples[q], samples[q + 1])
            if run >= total / 2:
                mid = samples[q]
                break
        out.append(f'<g class="restmark" transform="translate({mid[0]:.1f} {mid[1] - 12:.1f}) scale(.9)">'
                   f'<title>Rest stop: swap seats</title><g transform="translate(-12 -12)" fill="none" stroke="currentColor" '
                   f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{GLYPHS["rest"]}</g></g>')
    for i, m in enumerate(mods):
        x, y = pts[stop_at[i]]
        if qcount[m['n']] >= 3:
            out.append(f'<g class="viewmark" transform="translate({x + 22:.1f} {y - 24:.1f}) scale(.75)">'
                       f'<title>Viewpoint: plenty of questions worth stopping to talk over</title>'
                       f'<g transform="translate(-12 -12)" fill="none" stroke="currentColor" stroke-width="1.8" '
                       f'stroke-linecap="round" stroke-linejoin="round">{GLYPHS["view"]}</g></g>')
        out.append(f'<a href="#m{m["n"]}"><title>Module {m["n"]}: {html.escape(m["title"])}</title>'
                   f'<circle class="stop" cx="{x:.1f}" cy="{y:.1f}" r="17"/>'
                   f'<text class="num" x="{x:.1f}" y="{y + 5:.1f}">{m["n"]}</text>'
                   '</a>')
    # the bike at the start, the flag at the end
    sx, sy = pts[0]
    out.append(f'<g class="bike" transform="translate({sx - 20:.1f} {sy - 33:.1f}) scale(1.7)" fill="none" '
               f'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{BIKE}</g>')
    fx, fy = pts[-1]
    out.append(f'<a href="#telling-us"><title>Last stop: tell us what you found</title>'
               f'<path class="flag" d="M{fx - 6:.1f} {fy + 18:.1f}V{fy - 22:.1f}l22 9-22 9"/>'
               f'<text class="name" x="{fx:.1f}" y="{fy + 40:.1f}">Tell us</text></a>')
    out.append('</g></svg></div>')
    return ''.join(out)


def tours_html(doc):
    out = ['<h2 id="tours">Pick a tour</h2><span id="route"></span>',
           '<p>Take them in order, or jump to the one you need. Each has its own rest stops (a seat swap) and its own checklist. '
           f'<span class="legend"><span class="lg">{glyph("rest", 16)} rest stop: swap seats</span>'
           f'<span class="lg">{glyph("view", 16)} viewpoint: a module with plenty of questions to talk over</span></span></p>',
           '<div class="tours">']
    for t, T in doc['tours'].items():
        first = T['modules'][0]
        mods = ''.join(f'<li><a href="#m{n}"><span class="n">{n}</span> {html.escape(doc["modules"][n]["title"])}</a>'
                       f' <span class="who">{html.escape(doc["modules"][n]["who"])}</span></li>' for n in T['modules'])
        out.append(
            f'<article class="tour" id="tour{t}"><h3><span class="tnum">Tour {t}</span> {html.escape(T["title"])}</h3>'
            f'<p class="tag">{inline(T["tag"])}</p><p class="time">{inline(T["time"])}</p>{trail_svg(t, doc)}'
            f'<ol class="mods">{mods}</ol>'
            f'<p class="noprint"><a class="go" href="#m{first}">Start Tour {t} →</a> '
            f'<button type="button" data-print-tour="{t}">{glyph("print", 16)} Print this tour</button></p></article>')
    out.append('</div>')
    return ''.join(out)


def oldids_html(doc, ctx):
    rows = []
    redirects = {}
    allnew = ctx.ids
    for src, label in (('tour', 'Tour Guide'), ('advanced', 'Advanced Tour and drill')):
        for old, new, note in doc['old'][src]:
            if re.fullmatch(r'm\d+', old):
                tgt = new
                if int(new[1:]) not in doc['modules']:
                    raise SystemExit(f'old module row {old} -> {new}: no such module')
                rows.append(f'<tr data-old="{old}" data-new="{tgt}"><td>Module {old[1:]}</td>'
                            f'<td><a href="#{tgt}">Module {new[1:]}</a></td><td>{label}</td><td>{inline(note)}</td></tr>')
                if src == 'tour':
                    redirects[old] = tgt
                continue
            if new == '-':
                rows.append(f'<tr><td>{old}</td><td>retired</td><td>{label}</td><td>{inline(note)}</td></tr>')
                continue
            if new not in allnew:
                raise SystemExit(f'old ID {old} -> {new}: no such ID in the new tours')
            if old == new:
                continue
            extra = ''
            if old in allnew:
                extra = ' (This number now means something else.)' if note else 'This number now means something else.'
            redir = '' if old in allnew else f' data-old="{old}" data-new="{new}"'
            if redir and src == 'tour':
                redirects[old] = new
            rows.append(f'<tr{redir}><td>{old}</td><td><a href="#{new}">{new}</a></td><td>{label}</td>'
                        f'<td>{inline(note)}{extra}</td></tr>')
    return ('<details class="oldids" id="old-ids"><summary>Old IDs: where did my earlier notes go?</summary>'
            '<p>The tour used to be nine modules in one line, and the Advanced Tour and the Village Green Drill used the numbers 11 to 15. '
            'When the tour became three tours, every ID was renumbered. This table turns an old ID into the new one: '
            'IDs that did not change are left out. A link to an old ID that no longer exists, such as #T8.3, lands on its new place by itself. '
            'Ticks from the earlier guide start fresh. The Advanced Tour’s and the drill’s card numbers (C12.x, C13.x) changed too; '
            'the cards are in each module.</p>'
            '<div class="scroll"><table class="old"><tr><th>Old ID</th><th>Now</th><th>From</th><th>Note</th></tr>'
            + ''.join(rows) + '</table></div></details>'), redirects


# --------------------------------------------------------------------------------------- build

def build(doc):
    ctx = Ctx()
    tours = doc['tours']
    modules = doc['modules']
    mod_html = {}
    for n, m in modules.items():
        mod_html[n] = blocks_html(m['blocks'], ctx, m['tour'], n)
    start_html = blocks_html(doc['start'], ctx, None, 0)
    finish_html = blocks_html(doc['finish'], ctx, None, 10)

    tests = {t: sum(1 for x, tt, _, _ in ctx.items if tt == t and x[0] == 'T') for t in tours}
    qs = {t: sum(1 for x, tt, _, _ in ctx.items if tt == t and x[0] == 'Q') for t in tours}
    counts = (' '.join(f'Tour {t} has {tests[t]} tests and {qs[t]} questions.' for t in tours)
              + ' Nobody is expected to do them all: two modules and three honest lines help more than a full sheet of ticks.')
    old_html, redirects = oldids_html(doc, ctx)

    def fill(h):
        h = h.replace('{{tours}}', tours_html(doc)).replace('{{oldids}}', old_html).replace('{{counts}}', f'<p>{counts}</p>')
        for text, href in LINKS:
            h = h.replace(text, f'<a href="{href}">{text}</a>', 1)
        return h

    # Start
    start = fill(start_html)
    views = [f'<section class="view" id="start">{start}<p class="noprint">'
             f'<button type="button" id="print-all">{glyph("print", 16)} Print the whole tour</button></p></section>']
    # Modules
    for t, T in tours.items():
        ns = T['modules']
        for j, n in enumerate(ns):
            m = modules[n]
            prev = (f'<a href="#m{ns[j - 1]}">← {ns[j - 1]} · {modules[ns[j - 1]]["title"]}</a>' if j
                    else '<a href="#tours">← The tours</a>')
            nxt = (f'<a class="next" href="#m{ns[j + 1]}">{ns[j + 1]} · {modules[ns[j + 1]]["title"]} →</a>' if j < len(ns) - 1
                   else '<a class="next" href="#last-stop">Last stop →</a>')
            head = (f'<h2 id="m{n}" class="mod"><span class="icon" aria-hidden="true">{icon(m["icon"])}</span><span>'
                    f'<span class="mnum">Tour {t} · Module {n}</span> {html.escape(m["title"])}</span></h2>\n'
                    f'<p class="mprog" data-m="{n}"></p>')
            rest = rest_html() if j < len(ns) - 1 else ''
            views.append(f'<section class="view" data-view="m{n}" data-tour="{t}">{head}\n{fill(mod_html[n])}\n{rest}'
                         f'<nav class="pager" aria-label="Modules">{prev}{nxt}</nav></section>')
    # Last stop and Telling us (one view)
    fin = fill(finish_html)
    fin = fin.replace('<h2>Last stop</h2>', '<h2 id="last-stop">Last stop</h2>', 1)
    fin = fin.replace('<h2>Telling us what you found</h2>', '<h2 id="telling-us">Telling us what you found</h2>', 1)
    fin = fin.replace('<strong>Review and send</strong>', '<strong>Review and send</strong>')
    views.append(f'<section class="view" id="finish">{fin}</section>')
    body = '\n'.join(views)

    names = {n: m['title'] for n, m in modules.items()}
    side = []
    for t, T in tours.items():
        side.append(f'<li class="tourhead" data-tour="{t}"><span class="tnum">Tour {t}</span> {html.escape(T["title"])}</li>')
        for n in T['modules']:
            side.append(f'<li data-tour="{t}"><a href="#m{n}" data-m="{n}"><span class="icon">{icon(modules[n]["icon"])}</span>'
                        f'<span class="t"><span class="mnum">Module {n}</span>{html.escape(names[n])}</span>'
                        f'<span class="count"></span></a></li>')
    side = f'<nav class="side" aria-label="Modules"><ol>{"".join(side)}</ol></nav>'

    # The checklist, grouped by tour then module
    rows = []
    last_t = last_m = object()
    for x, t, n, b in ctx.items:
        if t != last_t:
            if t:
                rows.append(f'<tr class="tgrp" data-tour="{t}"><th colspan="6">Tour {t} · {html.escape(tours[t]["title"])}</th></tr>')
            else:
                rows.append('<tr class="tgrp"><th colspan="6">Last stop</th></tr>')
            last_t, last_m = t, object()
        if n != last_m:
            if t:
                rows.append(f'<tr class="grp" data-tour="{t}"><th colspan="6">Module {n} · {html.escape(names[n])}</th></tr>')
            last_m = n
        dt = f' data-tour="{t}"' if t else ''
        rows.append(f'<tr{dt}><td><input type="checkbox" class="tick" data-ids="{x}" aria-label="Done: {x}"></td>'
                    f'<td><a href="#{x}">{x}</a></td><td>{short(b)}</td><td></td><td></td><td></td></tr>')
    return body, ''.join(rows), side, len(ctx.items), redirects, ctx


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
     Built by build-from-doc.py from tour-source.md; edit that file, then rebuild.
     Item IDs (T3.4, Q5.2) and anchors (#m1-#m7, #m11-#m14, #m21-#m22, #need, #route, #tours, #telling-us, #sheet) are frozen:
     testers and the rangertrak.com beta post quote them. Retire an ID; never reuse or renumber.
     (E-317, 2026-11-15, renumbered them once; the Old IDs table on the Start page decodes the earlier ones.) -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>RangerTrak Tour Guide</title>
<meta name="description" content="Three tours of RangerTrak for beta testers: Easy menus, Full menus, and RangerView with field phones, with numbered tests and questions.">
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
    <a href="#start" id="tab-start">{i_start}<span>Start</span></a>
    <a href="#tours" id="tab-tours">{i_tours}<span>Tours</span></a>
    <a href="#m1" id="tab-modules">{i_modules}<span>Modules</span></a>
    <a href="#last-stop" id="tab-finish">{i_tell}<span>Telling us</span></a>
    <a href="#sheet" id="tab-sheet">{i_sheet}<span>Checklist</span></a>
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
<p class="noprint">Every test and question, grouped by tour. Tick boxes here or beside each step: they stay in this browser,
on this device. Print one tour or all three: <button type="button" data-print-sheet="1">{i_print} Tour 1</button>
<button type="button" data-print-sheet="2">{i_print} Tour 2</button>
<button type="button" data-print-sheet="3">{i_print} Tour 3</button>
<button type="button" data-print-sheet="all">{i_print} All</button>
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
    doc = parse(src)
    body, rows, side, total, redirects, ctx = build(doc)
    head = (HEAD.replace('{mark}', MARK)
            .replace('{applinks}', ''.join(f'<a href="{h}">{t}</a>' for h, t in APP_LINKS))
            .replace('{i_start}', glyph('start')).replace('{i_tours}', glyph('tours')).replace('{i_modules}', glyph('modules'))
            .replace('{i_tell}', glyph('tell')).replace('{i_sheet}', glyph('sheet'))
            .replace('{i_search}', glyph('search'))
            .replace('{total}', str(total)).replace('{side}', side))
    tail = TAIL.replace('{rows}', rows).replace('{i_print}', glyph('print', 16))
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + body + '\n' + tail)
    print('wrote', dst, f'({total} items)')
