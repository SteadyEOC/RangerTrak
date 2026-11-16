# SPDX-License-Identifier: AGPL-3.0-or-later
"""Builds tools/tour/index.html (the Tour Guide at rangertrak.org/tour/) from tools/tour/tour-source.md.

    py -3 tools/tour/build-from-doc.py tools/tour/tour-source.md [tools/tour/index.html]

The source is a plain text file anyone can edit; its short syntax is documented at the top of the file
itself. index.html is generated and never hand-edited. E-317 round 2 (2026-11-15) made the guide three
tours of legs: A Basics (Easy menus, legs A1-A6), B Advanced (Full menus, B1-B5) and C Enthusiasts
(C1-C4), plus Reference and Feedback pages. A step is a pass; its ID is the leg plus a number (A3.2);
a kept question is A3.Q1. Leg anchors are lowercase (#a3). tour.js keeps one small silent redirect from
the old #mN anchors that rangertrak.com links to (REDIRECTS below).
"""
import html
import math
import random
import re
import sys

# Leg icons: 24px line drawings in the accent colour, one per leg.
BINOCULARS = ('<circle cx="6.5" cy="15.5" r="3.5"/><circle cx="17.5" cy="15.5" r="3.5"/>'
              '<path d="M10 15.5h4M5 12l2-7h3l1 5M19 12l-2-7h-3l-1 5"/>')
# A bicycle, side on: two wheels, a diamond frame, saddle and handlebars (the tour's ride motif).
BIKE = ('<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/>'
        '<path d="M5.5 16.5L9 9.5L11.5 16.5ZM9 9.5H16L11.5 16.5M16 9.5L18.5 16.5M9 9.5L8.5 7.5M7 7.5h3M16 9.5L15.5 6.5M14.5 6.5h2.5"/>')
ICONS = {
    'A1': BINOCULARS,
    'A2': '<rect x="7" y="7" width="10" height="15" rx="2"/><path d="M9 7V2M10 11h4M10 14h4M10 17h4"/>',
    'A3': '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    'A4': '<path d="M12 10v12M8.5 22h7"/><circle cx="12" cy="8" r="2"/><path d="M7.8 3.8a6 6 0 0 0 0 8.4M16.2 3.8a6 6 0 0 1 0 8.4M5 1.5a9.5 9.5 0 0 0 0 13M19 1.5a9.5 9.5 0 0 1 0 13"/>',
    'A5': '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    'A6': '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 11h6M9 14h6M9 17h4"/>',
    'B1': '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    'B2': '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M8.5 10h7M8.5 14h7M8.5 18h4"/>',
    'B3': '<rect x="4" y="8" width="16" height="13" rx="2"/><path d="M9 8V5a3 3 0 0 1 6 0v3M4 14h16"/>',
    'B4': '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.5 7.5h13M5.5 16.5h13"/>',
    'B5': '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 12l2 2 4-4M9 18h6"/>',
    'C1': '<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M8 21h8M12 17v4M6 9h5M6 12h8"/>',
    'C2': '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    'C3': '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><path d="M7 11v4M17 11v4M7 15h10M12 15v6"/>',
    'C4': '<path d="M12 3l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z"/>',
}
SVG = ('<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" '
       'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{}</svg>')

# Small icons for the boxes, the tabs and the question marker, same line style.
GLYPHS = {
    'Setup': '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/>'
             '<circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    'Goals': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    'Situation': '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    'skills': '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    'q': '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
    'start': '<path d="M5 22V3M5 4h12l-2.5 4L17 12H5"/>',
    'tour': '<path d="M3 20c4-1 5-8 9-8s5 7 9 8"/><circle cx="12" cy="6" r="2"/>',
    'reference': '<path d="M4 4h6a3 3 0 0 1 2 .8A3 3 0 0 1 14 4h6v15h-6a3 3 0 0 0-2 .8 3 3 0 0 0-2-.8H4z"/><path d="M12 5v14"/>',
    'tell': '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9h8M8 12h5"/>',
    'print': '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
    'search': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
}


def glyph(name, size=18):
    return SVG.replace('width="22" height="22"', f'width="{size}" height="{size}" aria-hidden="true"').format(GLYPHS[name])


def icon(key):
    return SVG.format(ICONS[key])


# Links the text does not carry: (exact text as it appears in the page, href). First match only.
LINKS = [
    ('rangertrak.com and look over', None),
    ('go to rangertrak.org', '/'),
    ('RangerTrak@steadyeoc.com', 'mailto:RangerTrak@steadyeoc.com?subject=Tour'),
    ('github.com/SteadyEOC/RangerTrak/issues', 'https://github.com/SteadyEOC/RangerTrak/issues'),
]

# The old anchors rangertrak.com's published links use (the nine-module guide), and the round-1 tour anchors.
# tour.js turns these into a silent redirect. #tours is not here: it is a heading on Start.
REDIRECTS = {'m1': 'a1', 'm2': 'a2', 'm3': 'a3', 'm5': 'a4', 'm6': 'a5', 'm7': 'a6',
             'm4': 'b1', 'm9': 'c2', 'm8': 'c1', 'tour1': 'a1', 'tour2': 'b1', 'tour3': 'c1'}

TOUR_NAMES = {'A': 'Basics', 'B': 'Advanced', 'C': 'Enthusiasts'}

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
        p = re.sub(r'\[([^\]]+)\]\((#[^)\s]+)\)', r'<a href="\2">\1</a>', p)
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

STEP_RE = re.compile(r'^([ABC]\d+)\.(Q?\d+)(?:-(\d+))?\s+(.*)$')
BOX_RE = re.compile(r'^(Setup|Goals|Situation):\s*(.*)$')


def parse(path):
    """The source as a dict: start / reference / feedback block lists, tours and legs (each a block list)."""
    lines = open(path, encoding='utf-8').read().split('\n')
    doc = {'start': [], 'reference': [], 'feedback': [], 'tours': {}, 'legs': {}}
    cur = doc['start']
    tour = None
    i = 0
    while i < len(lines):
        raw = lines[i].rstrip()
        i += 1
        if not raw.strip() or raw.startswith(';;'):
            continue
        if raw.startswith(('@start', '@reference', '@feedback')):
            name = raw[1:].split()[0]
            cur = doc[name]
            continue
        if raw.startswith('@tour '):
            a = [x.strip() for x in raw[6:].split('|')]
            tour = a[0]
            doc['tours'][tour] = {'n': tour, 'title': a[1], 'tag': a[2], 'time': a[3] if len(a) > 3 else '', 'legs': []}
            continue
        if raw.startswith('@leg '):
            a = [x.strip() for x in raw[5:].split('|')]
            n = a[0]
            leg = {'n': n, 'title': a[1], 'who': a[2], 'tour': tour, 'blocks': []}
            doc['legs'][n] = leg
            doc['tours'][tour]['legs'].append(n)
            cur = leg['blocks']
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
        elif raw.startswith('Note:'):
            cur.append(('note', raw[5:].strip()))
        elif STEP_RE.match(raw):
            m = STEP_RE.match(raw)
            cur.append(('step', m.group(1), m.group(2), int(m.group(3)) if m.group(3) else None, m.group(4)))
        else:
            cur.append(('p', raw))
    return doc


# ---------------------------------------------------------------------------------------- render

_SHOTS = None


def shot_html(iid):
    """A small picture of the control a step names; made by tools/tour/capture-shots.js (img/shots.json)."""
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
        self.items = []      # (id, tour, leg, body html, is_question)
        self.ids = set()
        self.cards = {}      # (leg, '1') -> its "Should land at" text


REST = ('<aside class="rest"><span class="restico" aria-hidden="true">{ico}</span><p><strong>Rest stop.</strong> '
        '{text}</p></aside>')
REST_TEXT = ('Swap seats: everyone moves one seat round, and the new scribe starts the next leg. '
             'Stretch, refill the coffee, and compare notes before you go on.')
PICNIC = ('<rect x="-9" y="-6" width="18" height="3" rx="1"/><path d="M-8 -3l-3 9M8 -3l3 9M-5 -3l-2 9M5 -3l2 9M-11 2h22"/>')


def rest_html(text=None):
    ico = ('<svg viewBox="-14 -12 28 22" width="26" height="22" fill="none" stroke="currentColor" stroke-width="1.6" '
           f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{PICNIC}</svg>')
    return REST.format(ico=ico, text=inline(text) if text else REST_TEXT)


def table_html(cells, ctx, leg):
    is_cards = cells[0][0] == 'Card'
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
        if is_cards and r_i and re.fullmatch(r'\d+', r[0]) and leg:
            ctx.cards[(leg, r[0])] = plain(inline(r[-1]))
    cls = ' class="cards"' if is_cards else ''
    return f'<div class="scroll"><table{cls}>' + ''.join(out) + '</table></div>'


def blocks_html(blocks, ctx, tour=None, leg=None):
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
            out.append(steps_html(steps, ctx, tour, leg))
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
            out.append(f'<h1><span class="bikeico" aria-hidden="true">{SVG.format(BIKE)}</span>{inline(b[1])}</h1>')
        elif k == 'h2':
            out.append(f'<h2>{inline(b[1])}</h2>')
        elif k == 'h3':
            out.append(f'<h3>{inline(b[1])}</h3>')
        elif k == 'quote':
            out.append(f'<blockquote><p>{inline(b[1])}</p></blockquote>')
        elif k == 'pre':
            out.append('<pre>' + html.escape(b[1], quote=False) + '</pre>')
        elif k == 'table':
            out.append(table_html(b[1], ctx, leg))
        elif k == 'skills':
            out.append(f'<p class="skills">{glyph("skills")} <span><strong>Skills learned:</strong> {inline(b[1])}</span></p>')
        elif k == 'note':
            out.append(f'<p class="oddnote">{inline(b[1])}</p>')
        elif k == 'swap':
            out.append(rest_html(b[1]))
        elif k == 'placeholder':
            out.append('{{' + b[1] + '}}')
        else:
            raise SystemExit(f'unknown block {k}')
    flush()
    return '\n'.join(out)


def steps_html(steps, ctx, tour, leg):
    lis = []
    prev = ''
    for _, stem, num, last, text in steps:
        iid = f'{stem}.{num}'
        is_q = num.startswith('Q')
        if iid in ctx.ids:
            raise SystemExit(f'ID {iid} appears twice')
        ids = [iid]
        spans = ''
        body = inline(text)
        if last:
            first = int(num)
            ids = [f'{stem}.{n}' for n in range(first, last + 1)]
            spans = ''.join(f'<span id="{x}"></span>' for x in ids[1:])
            for x in ids:
                if x in ctx.ids:
                    raise SystemExit(f'ID {x} appears twice')
        for x in ids:
            ctx.ids.add(x)
        if last:
            for x in ids:
                n = x.split('.')[1]
                where = ctx.cards.get((stem, n), 'where the card table’s last column says')
                ctx.items.append((x, tour, stem, f'Card {n} lands at {where}.', False))
        else:
            ctx.items.append((iid, tour, stem, body, is_q))
        cls = 'q' if is_q else 't'
        if cls == 'q' and prev == 't':
            cls = 'q first'
        prev = cls[0]
        what = 'Answered' if is_q else 'Passed'
        tick = (f'<input type="checkbox" class="tick" data-ids="{" ".join(ids)}" aria-label="{what}: {iid}">')
        mark = glyph('q', 15) if is_q else ''
        lis.append(f'<li id="{iid}" class="{cls}">{spans}{tick}<div><strong>{mark}{iid}</strong> {body} '
                   f'<a class="self" href="#{iid}" aria-label="Link to {iid}">#</a>{shot_html(iid)}</div></li>')
    return '<ul class="checks">' + ''.join(lis) + '</ul>'


# --------------------------------------------------------------------------------------- scenery
# Small flat drawings along the way: decorative only (aria-hidden), no legend. Each is drawn about its
# own origin (bottom centre) in a 24-unit box and coloured by CSS classes (light, dark and print).

SCENERY = {
    'pine': ('<path class="sc-tree" d="M0 -22L-7 -10H-3L-9 0H-3L-11 10H11L3 0H9L3 -10H7Z"/>'
             '<path class="sc-trunk" d="M-1.5 10h3v5h-3z"/>'),
    'round': ('<circle class="sc-tree" cx="0" cy="-8" r="9"/><circle class="sc-tree2" cx="-3" cy="-11" r="4"/>'
              '<path class="sc-trunk" d="M-1.5 0h3v10h-3z"/>'),
    'flowers': ('<path class="sc-stem" d="M-8 8V-2M0 8V-6M8 8V-1"/>'
                '<circle class="sc-bloom" cx="-8" cy="-4" r="3"/><circle class="sc-bloom2" cx="0" cy="-8" r="3"/>'
                '<circle class="sc-bloom" cx="8" cy="-3" r="3"/>'),
    'lake': ('<ellipse class="sc-water" cx="0" cy="0" rx="24" ry="9"/>'
             '<path class="sc-wave" d="M-12 -1q3-3 6 0t6 0M0 3q3-3 6 0t6 0"/>'),
    'pond': ('<ellipse class="sc-water" cx="0" cy="0" rx="15" ry="6"/><path class="sc-wave" d="M-7 0q2-2 4 0t4 0"/>'),
    'mountain': ('<path class="sc-rock" d="M-26 12L0 -26L26 12Z"/><path class="sc-snow" d="M0 -26L-8 -12L-3 -15L0 -10L4 -15L8 -12Z"/>'),
    'peak': ('<path class="sc-rock2" d="M-18 12L-2 -16L18 12Z"/><path class="sc-snow" d="M-2 -16L-9 -4L-4 -7L-1 -3L3 -8L5 -4Z"/>'),
    'hill': ('<path class="sc-hill" d="M-30 12Q-14 -14 0 -14T30 12Z"/>'),
}
# What each tour's countryside is made of, and how many of each.
MIX = {
    'A': [('pine', 5), ('round', 5), ('flowers', 5), ('pond', 1)],
    'B': [('hill', 4), ('lake', 1), ('pine', 4), ('round', 2), ('flowers', 2)],
    'C': [('mountain', 3), ('peak', 3), ('pine', 5), ('hill', 1)],
}


def _bez(p0, c1, c2, p1, t):
    u = 1 - t
    return (u**3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p1[0],
            u**3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p1[1])


def trail_svg(tour, doc):
    """One tour's route: a path that wanders (gentle in A, hilly in B, mountainous in C), a circle per leg, a
    picnic table under a tree at each seat swap, scenery along the way, the bike at the start and the flag."""
    legs = [doc['legs'][n] for n in doc['tours'][tour]['legs']]
    amp = {'A': 12, 'B': 30, 'C': 44}[tour]
    extra = {'A': 0, 'B': 1, 'C': 2}[tour]
    base = {'A': 112, 'B': 124, 'C': 134}[tour]
    wob = [0.0, -1.0, 0.8, -0.7, 1.0, -0.9, 0.6, -0.5, 0.9, -1.0, 0.7, -0.6, 0.8, -0.8]
    W = 640
    x0, x1 = 100, 545
    n = len(legs)
    pts, stop_at, k = [(30, base + 4)], [], 0
    seg = (x1 - x0) / (n - 1) if n > 1 else 0
    for i, m in enumerate(legs):
        if i:
            for e in range(1, extra + 1):
                k += 1
                x = x0 + seg * (i - 1) + seg * e / (extra + 1)
                pts.append((x, base + amp * wob[k % len(wob)]))
        k += 1
        pts.append((x0 + seg * i, base + amp * wob[k % len(wob)] * 0.7))
        stop_at.append(len(pts) - 1)
    pts.append((W - 38, base - 8))
    segs = []
    for j in range(len(pts) - 1):
        p0, p1 = pts[max(j - 1, 0)], pts[j]
        p2, p3 = pts[j + 1], pts[min(j + 2, len(pts) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        segs.append((p1, c1, c2, p2))
    d = f'M{pts[0][0]:.1f} {pts[0][1]:.1f}' + ''.join(
        f'C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}' for _, c1, c2, p2 in segs)
    samples = []
    for s_ in segs:
        samples += [_bez(*s_, t / 14) for t in range(14)]
    samples.append(pts[-1])
    H = {'A': 190, 'B': 215, 'C': 235}[tour]
    label = ', '.join(f'leg {m["n"]} {m["title"]}' for m in legs)
    out = [f'<div class="scroll"><svg class="trail" viewBox="0 0 {W} {H}" role="img" aria-label="The route of Tour {tour}: {label}, '
           f'then tell us what you found. A picnic table marks each seat swap.">']
    # Scenery first, so the path and circles sit on top. Placed only where it clears the path and the stops.
    rnd = random.Random({'A': 11, 'B': 23, 'C': 37}[tour])
    wanted = [kind for kind, count in MIX[tour] for _ in range(count)]
    rnd.shuffle(wanted)
    keep_out = [pt for pt in samples] + [pts[i] for i in stop_at]
    rests = []
    for a, b in zip(stop_at, stop_at[1:]):
        pts_seg = []
        for j in range(a, b):
            pts_seg += [_bez(*segs[j], t / 12) for t in range(12)]
        pts_seg.append(pts[b])
        total = sum(math.dist(pts_seg[q], pts_seg[q + 1]) for q in range(len(pts_seg) - 1))
        run, mid = 0.0, pts_seg[0]
        for q in range(len(pts_seg) - 1):
            run += math.dist(pts_seg[q], pts_seg[q + 1])
            if run >= total / 2:
                mid = pts_seg[q]
                break
        rests.append(mid)
    placed = []
    scenery = []
    tries = 0
    for kind in wanted:
        radius = {'mountain': 34, 'lake': 30, 'hill': 32, 'peak': 24, 'pond': 20}.get(kind, 17)
        for _ in range(60):
            tries += 1
            x = rnd.uniform(60, W - 40)
            y = rnd.uniform(34, H - 26)
            if any(math.dist((x, y), q) < radius + 24 for q in keep_out):
                continue
            if any(math.dist((x, y), q) < radius + 36 for q in rests):
                continue
            if any(math.dist((x, y), q[:2]) < radius + q[2] for q in placed):
                continue
            placed.append((x, y, radius))
            scenery.append((y, kind, x))
            break
    scenery.sort()
    out.append('<g class="scenery" aria-hidden="true">')
    for y, kind, x in scenery:
        out.append(f'<g transform="translate({x:.1f} {y:.1f})">{SCENERY[kind]}</g>')
    out.append('</g>')
    out.append(f'<path class="path" d="{d}"/>')
    # a picnic table under a tree at the middle of every stretch between two stops: a seat swap
    for mx, my in rests:
        out.append(f'<g class="restmark" transform="translate({mx:.1f} {my - 26:.1f})"><title>Rest stop: swap seats</title>'
                   f'<g class="sc-tree" transform="translate(-14 -6) scale(.55)">{SCENERY["round"]}</g>'
                   f'<g class="picnic" transform="translate(4 0) scale(.9)" fill="none" stroke="currentColor" stroke-width="1.6" '
                   f'stroke-linecap="round">{PICNIC}</g></g>')
    for i, m in enumerate(legs):
        x, y = pts[stop_at[i]]
        out.append(f'<a href="#{m["n"].lower()}"><title>Leg {m["n"]}: {html.escape(m["title"])}</title>'
                   f'<circle class="stop" cx="{x:.1f}" cy="{y:.1f}" r="19"/>'
                   f'<text class="num" x="{x:.1f}" y="{y + 6:.1f}">{m["n"]}</text></a>')
    sx, sy = pts[0]
    out.append(f'<g class="bike" transform="translate({sx - 28:.1f} {sy - 46:.1f}) scale(2.3)" fill="none" '
               f'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">{BIKE}</g>')
    fx, fy = pts[-1]
    out.append(f'<a href="#telling-us"><title>Last stop: tell us what you found</title>'
               f'<path class="flag" d="M{fx - 6:.1f} {fy + 20:.1f}V{fy - 22:.1f}l22 9-22 9"/></a>')
    out.append('</svg></div>')
    return ''.join(out)


def tours_html(doc):
    out = ['<h2 id="tours">Pick a tour</h2><span id="route"></span>',
           '<p>Take them in order, or jump to the one you need. Each tour is a route of legs; every leg is its own page, '
           'with a rest stop (a seat swap) between legs.</p>', '<div class="tours">']
    who = {'A': 'For anyone who will log calls: no setup needed.',
           'B': 'For whoever sets up and runs a mission.',
           'C': 'For enthusiasts: RangerView, field phones, several posts and extras.'}
    for t, T in doc['tours'].items():
        legs = ''.join(f'<li><a href="#{n.lower()}"><span class="n">{n}</span>{html.escape(doc["legs"][n]["title"])}</a></li>'
                       for n in T['legs'])
        out.append(
            f'<article class="tour" id="tour{t}"><h3><span class="tnum">Tour {t}</span> {TOUR_NAMES[t]}</h3>'
            f'<p class="tag">{inline(who[t])}</p>{trail_svg(t, doc)}'
            f'<ol class="mods">{legs}</ol>'
            f'<p class="noprint"><a class="go" href="#{T["legs"][0].lower()}">Start Tour {t} →</a></p></article>')
    out.append('</div>')
    return ''.join(out)


# --------------------------------------------------------------------------------------- build

def build(doc):
    ctx = Ctx()
    tours = doc['tours']
    legs = doc['legs']
    leg_html = {}
    for n, m in legs.items():
        leg_html[n] = blocks_html(m['blocks'], ctx, m['tour'], n)
    start_html = blocks_html(doc['start'], ctx, None, None)
    ref_html = blocks_html(doc['reference'], ctx, None, None)
    fb_html = blocks_html(doc['feedback'], ctx, None, None)

    passes = {t: sum(1 for x, tt, _, _, q in ctx.items if tt == t and not q) for t in tours}
    qs = {t: sum(1 for x, tt, _, _, q in ctx.items if tt == t and q) for t in tours}
    counts = (' '.join(f'Tour {t} has {passes[t]} passes and {qs[t]} questions.' for t in tours)
              + ' Nobody is expected to do them all: a few legs and three honest lines help more than a full sheet of ticks.')

    def fill(h):
        h = h.replace('{{tours}}', tours_html(doc)).replace('{{counts}}', f'<p>{counts}</p>')
        for text, href in LINKS:
            if href:
                h = h.replace(text, f'<a href="{href}">{text}</a>', 1)
        h = h.replace('Open rangertrak.com and look over', 'Open <a href="https://rangertrak.com/">rangertrak.com</a> and look over', 1)
        h = h.replace('What it does, Field Guide, Blog', 'What it does, <a href="https://rangertrak.com/field-guide.html">Field Guide</a>, Blog', 1)
        return h

    views = [f'<section class="view" id="start">{fill(start_html)}</section>']
    for t, T in tours.items():
        ns = T['legs']
        tour_ids = list(tours)
        for j, n in enumerate(ns):
            m = legs[n]
            prev = (f'<a href="#{ns[j - 1].lower()}">← {ns[j - 1]} · {legs[ns[j - 1]]["title"]}</a>' if j
                    else '<a href="#start">← Start</a>')
            if j < len(ns) - 1:
                nxt = f'<a class="next" href="#{ns[j + 1].lower()}">{ns[j + 1]} · {legs[ns[j + 1]]["title"]} →</a>'
            else:
                nxt = '<a class="next" href="#last-stop">Last stop →</a>'
            head = (f'<h2 id="{n.lower()}" class="mod"><span class="icon" aria-hidden="true">{icon(n)}</span><span>'
                    f'<span class="mnum">Tour {t} · Leg {n}</span> {html.escape(m["title"])}</span></h2>\n'
                    f'<p class="mprog" data-m="{n}"></p>')
            rest = rest_html() if j < len(ns) - 1 else ''
            views.append(f'<section class="view" data-view="{n.lower()}" data-tour="{t}">{head}\n{fill(leg_html[n])}\n{rest}'
                         f'<nav class="pager" aria-label="Legs">{prev}{nxt}</nav></section>')
    views.append(f'<section class="view" id="reference">{fill(ref_html)}</section>')

    # Feedback: Last stop, Telling us, then the checklist (its only Print button)
    fb = fill(fb_html)
    fb = fb.replace('<h2>Last stop</h2>', '<h2 id="last-stop">Last stop</h2>', 1)
    fb = fb.replace('<h2>Telling us what you found</h2>', '<h2 id="telling-us">Telling us what you found</h2>', 1)
    rows = []
    last_t = last_m = object()
    for x, t, n, b, q in ctx.items:
        if t != last_t:
            rows.append(f'<tr class="tgrp" data-tour="{t}"><th colspan="6">Tour {t} · {TOUR_NAMES[t]}'
                        f' ({passes[t]} passes, {qs[t]} questions)</th></tr>')
            last_t, last_m = t, object()
        if n != last_m:
            rows.append(f'<tr class="grp" data-tour="{t}"><th colspan="6">Leg {n} · {html.escape(legs[n]["title"])}</th></tr>')
            last_m = n
        what = 'Answered' if q else 'Passed'
        rows.append(f'<tr data-tour="{t}"><td><input type="checkbox" class="tick" data-ids="{x}" aria-label="{what}: {x}"></td>'
                    f'<td><a href="#{x}">{x}</a></td><td>{short(b)}</td><td></td><td></td><td></td></tr>')
    sheet = (f'<div class="sheet-part"><h2 id="sheet">Checklist</h2>'
             f'<p class="noprint">Every pass and question, grouped by tour. Tick boxes here or beside each step: they stay in this browser, '
             f'on this device. For anyone who likes paper at a drill: '
             f'<button type="button" id="print-sheet">{glyph("print", 16)} Print the checklist</button> '
             f'<button type="button" id="clear-ticks">Clear my ticks</button></p>'
             f'<p class="fields">Name ____________________ &nbsp; Date __________ &nbsp; Device and browser ____________________ &nbsp; RangerTrak version __________</p>'
             f'<div class="scroll"><table class="sheet"><tr><th>Done</th><th>ID</th><th>Step</th><th>Pass</th><th>Fail</th><th>Note</th></tr>'
             + ''.join(rows) + '</table></div></div>')
    views.append(f'<section class="view" id="feedback"><div class="fb-text">{fb}</div>{sheet}</section>')
    body = '\n'.join(views)

    # the side list: every leg of every tour, grouped under a heading
    side = []
    for t, T in tours.items():
        side.append(f'<li class="tourhead" data-tour="{t}"><span class="tnum">Tour {t}</span> {TOUR_NAMES[t]}</li>')
        for n in T['legs']:
            side.append(f'<li data-tour="{t}"><a href="#{n.lower()}" data-m="{n}"><span class="icon">{icon(n)}</span>'
                        f'<span class="t"><span class="mnum">Leg {n}</span>{html.escape(legs[n]["title"])}</span>'
                        f'<span class="count"></span></a></li>')
    side = f'<nav class="side" aria-label="Legs"><ol>{"".join(side)}</ol></nav>'
    return body, side, len(ctx.items), ctx, counts


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
     Step IDs (A3.2, A3.Q1) and anchors (#a1-#a6, #b1-#b5, #c1-#c4, #reference, #last-stop, #telling-us, #sheet, #tours) are frozen:
     testers and the rangertrak.com beta post quote them. Retire an ID; never reuse or renumber.
     (E-317 round 2, 2026-11-15: three tours of legs. The old #m1 to #m9 anchors redirect, see tour.js.) -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>RangerTrak Tour Guide</title>
<meta name="description" content="Three guided tours of RangerTrak for beta testers: Basics with Easy menus, Advanced with Full menus, and Enthusiasts (RangerView, field phones, several posts), with passes to try and a Reference tab.">
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
    <a href="#a1" id="tab-A">{i_tour}<span>Tour A</span></a>
    <a href="#b1" id="tab-B">{i_tour}<span>Tour B</span></a>
    <a href="#c1" id="tab-C">{i_tour}<span>Tour C</span></a>
    <a href="#reference" id="tab-reference">{i_ref}<span>Reference</span></a>
    <a href="#last-stop" id="tab-feedback">{i_tell}<span>Feedback</span></a>
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

TAIL = '''</main>
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
    body, side, total, ctx, counts = build(doc)
    head = (HEAD.replace('{mark}', MARK)
            .replace('{applinks}', ''.join(f'<a href="{h}">{t}</a>' for h, t in APP_LINKS))
            .replace('{i_start}', glyph('start')).replace('{i_tour}', glyph('tour')).replace('{i_ref}', glyph('reference'))
            .replace('{i_tell}', glyph('tell')).replace('{i_search}', glyph('search'))
            .replace('{total}', str(total)).replace('{side}', side))
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + body + '\n' + TAIL)
    print('wrote', dst, f'({total} items)')
    import json
    print('redirects', json.dumps(REDIRECTS))
