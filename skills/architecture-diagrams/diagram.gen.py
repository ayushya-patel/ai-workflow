#!/usr/bin/env python3
"""Architecture-diagram generator with a geometry validator.

Edit ONLY the section marked ── CONTENT ──. Run it; it writes the HTML next to itself
(or to OUT) and exits 1 if anything collides:
  · every arrow endpoint lies on a node edge (use E(node, side, t) — never raw coords)
  · no arrow segment crosses a node
  · no label overlaps a node or touches a line
  · no text overflows its node (per-font width budget)
  · nodes ≥ 20px apart
  · no label or node straddles a region border
Brand logos (Simple Icons, CC0) are attached only on an exact alias match — see BRANDS.
Coordinates are in a fixed viewBox; the HTML scales it to the viewport.
"""
import sys, pathlib, os, re, urllib.request

# ── STYLE (house tokens; change once) ────────────────────────────────────────
INK, MUTED, RULE = "#111111", "#5C6066", "#C9C8C1"
BLUE, ORANGE, GREEN, RED = "#1E6FFF", "#C8641E", "#1F7A4D", "#B3261E"
CHAR = {"body": 6.35, "mono": 6.65, "title": 9.2}      # px per char at base sizes
FONTS = "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Source+Serif+4:ital,opsz,wght@1,8..60,400&family=JetBrains+Mono:wght@400;500&display=swap"

nodes, texts, arrows, out, errs = {}, [], [], [], []
def err(m): errs.append(m)
def fits(s, kind, avail, where):
    if len(s) * CHAR[kind] > avail: err(f"{where}: '{s}' {len(s)*CHAR[kind]:.0f}px > {avail:.0f}px")

ICONS = {  # monoline, ~22px, drawn at (x, y) top-left
 "screen": lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><rect x="{x}" y="{y}" width="24" height="15" rx="2"/><path d="M{x+8},{y+21} h8 M{x+12},{y+15} v6"/></g>',
 "phone":  lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><rect x="{x+6}" y="{y}" width="12" height="22" rx="2.5"/><path d="M{x+10},{y+19} h4"/></g>',
 "people": lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><circle cx="{x+8}" cy="{y+7}" r="4"/><circle cx="{x+18}" cy="{y+8}" r="3.2"/><path d="M{x},{y+22} c0,-6 4,-9 8,-9 s8,3 8,9 M{x+18},{y+13} c4,0 7,3 7,8"/></g>',
 "db":     lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><ellipse cx="{x+11}" cy="{y+4}" rx="10" ry="4"/><path d="M{x+1},{y+4} v14 a10,4 0 0 0 20,0 v-14 M{x+1},{y+11} a10,4 0 0 0 20,0"/></g>',
 "bucket": lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><path d="M{x+1},{y+5} h20 l-2.5,16 h-15 z"/><ellipse cx="{x+11}" cy="{y+5}" rx="10" ry="3"/></g>',
 "cloud":  lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><path d="M{x+6},{y+20} h13 a5,5 0 0 0 1,-10 a7,7 0 0 0 -13,-2 a6,6 0 0 0 -1,12 z"/></g>',
 "code":   lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.6"><path d="M{x+7},{y+4} l-6,7 6,7 M{x+17},{y+4} l6,7 -6,7 M{x+14},{y+2} l-4,18"/></g>',
 "pen":    lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><path d="M{x+3},{y+19} l2,-6 11,-11 4,4 -11,11 z M{x+13},{y+5} l4,4"/></g>',
 "gate":   lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><path d="M{x+2},{y+21} v-14 h6 v14 M{x+16},{y+21} v-14 h6 v14 M{x+2},{y+7} h20 M{x+8},{y+14} h8"/></g>',
 "queue":  lambda x,y,c: f'<g fill="none" stroke="{c}" stroke-width="1.5"><rect x="{x}" y="{y+4}" width="6" height="14"/><rect x="{x+9}" y="{y+4}" width="6" height="14"/><rect x="{x+18}" y="{y+4}" width="6" height="14"/></g>',
}

# ── BRANDS ───────────────────────────────────────────────────────────────────
# Exact, lower-cased title or "·"-separated subtitle segment → Simple Icons slug. Never fuzzy:
# a wrong logo is worse than the generic icon. Add an alias only after checking the slug renders.
SIMPLE_ICONS = "13.21.0"
ICON_CACHE = pathlib.Path(os.environ.get("ICON_CACHE", pathlib.Path.home() / ".cache/architecture-diagrams/icons"))
BRANDS = {
 "redis": "redis", "postgres": "postgresql", "postgresql": "postgresql", "mysql": "mysql", "mariadb": "mariadb",
 "mongodb": "mongodb", "sqlite": "sqlite", "elasticsearch": "elasticsearch", "opensearch": "opensearch",
 "kafka": "apachekafka", "apache kafka": "apachekafka", "rabbitmq": "rabbitmq", "meilisearch": "meilisearch", "algolia": "algolia",
 "aws": "amazonwebservices", "s3": "amazons3", "amazon s3": "amazons3", "rds": "amazonrds", "amazon rds": "amazonrds",
 "ecs": "amazonecs", "eks": "amazoneks", "elasticache": "amazonelasticache", "lambda": "awslambda", "aws lambda": "awslambda",
 "sqs": "amazonsqs", "dynamodb": "amazondynamodb", "cognito": "amazoncognito", "api gateway": "amazonapigateway",
 "google cloud": "googlecloud", "gcp": "googlecloud", "cloudflare": "cloudflare", "vercel": "vercel", "firebase": "firebase", "supabase": "supabase",
 "kubernetes": "kubernetes", "k8s": "kubernetes", "docker": "docker", "nginx": "nginx", "terraform": "terraform",
 "react": "react", "react router": "reactrouter", "next.js": "nextdotjs", "vue": "vuedotjs", "angular": "angular", "svelte": "svelte", "expo": "expo",
 "node.js": "nodedotjs", "bun": "bun", "hono": "hono", "go": "go", "python": "python", "java": "openjdk", "spring": "spring", "spring boot": "springboot",
 "graphql": "graphql", "strapi": "strapi", "payload": "payloadcms", "payload cms": "payloadcms", "medusa": "medusa", "medusa.js": "medusa",
 "contentful": "contentful", "sanity": "sanity", "wordpress": "wordpress", "shopify": "shopify", "stripe": "stripe", "auth0": "auth0",
 "github": "github", "grafana": "grafana", "prometheus": "prometheus", "sentry": "sentry",
}
def brand_path(slug, explicit):
    """SVG path data for a slug, fetched once into ICON_CACHE. Missing explicit brand = error; missing auto brand = generic icon."""
    f = ICON_CACHE / f"{slug}.svg"
    if not f.exists():
        try:
            data = urllib.request.urlopen(f"https://cdn.jsdelivr.net/npm/simple-icons@{SIMPLE_ICONS}/icons/{slug}.svg", timeout=10).read()
            ICON_CACHE.mkdir(parents=True, exist_ok=True); f.write_bytes(data)
        except Exception as e:
            (err if explicit else print)(f"brand '{slug}': not fetched ({e}) — {'fix the slug' if explicit else 'using generic icon'}")
            return None
    m = re.search(r'<path d="([^"]+)"', f.read_text())
    return m and m.group(1)
def pick_brand(name, title, sub, brand):
    """brand=slug forces one, brand=False opts out. Auto: an exact title alias wins; else exactly one subtitle
    segment must match — two matches (e.g. 'Java · Spring Boot') is ambiguous and keeps the generic icon."""
    if brand is False: return None
    if brand: return brand
    if title.lower() in BRANDS: return BRANDS[title.lower()]
    hits = [BRANDS[s] for s in (seg.strip().lower() for seg in sub.split("·")) if s in BRANDS]
    if len(set(hits)) > 1: print(f"{name}: brand ambiguous {sorted(set(hits))} — generic icon kept; pass brand= to choose")
    return hits[0] if len(set(hits)) == 1 else None
def brand_svg(d, x, y, c, size=22):
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 24 24"><path d="{d}" fill="{c}"/></svg>'

def node(name, x, y, w, h, title, sub, bullets=(), shape="rect", accent=INK, fill="#FFFFFF", icon=None, tsize=16, small=False, brand=None):
    """A block. bullets: strings; a leading space marks a continuation line (no bullet, hanging indent).
    shape='cyl' draws a database cylinder (centred text). small=True tightens padding/fonts for ≤110px boxes.
    brand: Simple Icons slug to force a logo, False to opt out, None to auto-match the title/subtitle (see BRANDS)."""
    nodes[name] = (x, y, w, h)
    slug = pick_brand(name, title, sub, brand)
    bpath = brand_path(slug, bool(brand)) if slug else None
    pad, tsz, bsz, step = (12, 11, 12, 16) if small else (14, 10.5, 12.5, 17)
    if small: tsize = min(tsize, 15)
    if shape == "cyl":
        ry = 11
        out.append(f'<path d="M{x},{y+ry} a{w/2},{ry} 0 0 1 {w},0 v{h-2*ry} a{w/2},{ry} 0 0 1 -{w},0 z" fill="{fill}" stroke="{accent}" stroke-width="1.5"/>')
        out.append(f'<ellipse cx="{x+w/2}" cy="{y+ry}" rx="{w/2}" ry="{ry}" fill="{fill}" stroke="{accent}" stroke-width="1.5"/>')
        tx, ty, anchor = x + w/2, y + ry + 30, "middle"
        if bpath:   # logo sits left of the centred title; the pair must still fit the barrel
            tw = len(title) * CHAR["title"] * tsize / 16
            if tw + 26 > w - 20: err(f"{name}: title + logo too wide for {w}px cylinder (pass brand=False or widen)")
            out.append(brand_svg(bpath, tx - tw/2 - 24, ty - 16, accent, 18))
    else:
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{fill}" stroke="{accent}" stroke-width="1.5"/>')
        tx, ty, anchor = x + pad, y + 27, "start"
        if bpath: out.append(brand_svg(bpath, x + pad, y + 12, accent)); tx += 34
        elif icon: out.append(ICONS[icon](x + pad, y + 12, accent)); tx += 34
    out.append(f'<text x="{tx}" y="{ty}" text-anchor="{anchor}" font-size="{tsize}" font-weight="600" fill="{accent}">{title}</text>')
    out.append(f'<text x="{tx}" y="{ty+17}" text-anchor="{anchor}" font-family="JetBrains Mono, monospace" font-size="{tsz}" fill="{MUTED}">{sub}</text>')
    avail = w - (tx - x) - 12 if anchor == "start" else w - 20
    if len(title) * CHAR["title"] * tsize / 16 > avail: err(f"{name}: title '{title}' too wide for {w}px box")
    fits(sub, "mono", avail, name)
    by = ty + 40
    for b in bullets:
        cont = b.startswith(" ")
        bx = x + pad if anchor == "start" else tx
        if anchor == "start":
            txt = b.strip() if cont else "• " + b
            if cont: bx += 11
        else: txt = b
        out.append(f'<text x="{bx}" y="{by}" text-anchor="{anchor}" font-size="{bsz}" fill="#1A1A1A">{txt}</text>')
        fits(txt, "body", w - (bx - x) - 12 if anchor == "start" else w - 20, name); by += step
    if by - step > y + h - 8: err(f"{name}: text overflows bottom by {by-step-(y+h-8):.0f}px")

def E(name, side, t=0.5):
    """Point on a node edge: side l/r/t/b, t = fraction along that edge. Pick t so both ends of a
    horizontal arrow share a y (or vertical share an x) — otherwise it renders 1px off-diagonal."""
    x, y, w, h = nodes[name]
    return {"l": (x, y+h*t), "r": (x+w, y+h*t), "t": (x+w*t, y), "b": (x+w*t, y+h)}[side]

def ty(name, y):
    """t along a node's left/right edge that lands on absolute y — use to keep a horizontal arrow level."""
    x0, y0, w, h = nodes[name]; return (y - y0) / h
def tx(name, x):
    """t along a node's top/bottom edge that lands on absolute x — use to keep a vertical arrow plumb."""
    x0, y0, w, h = nodes[name]; return (x - x0) / w

def arrow(pts, color=INK, dashed=False, both=False, width=1.7):
    """Orthogonal polyline. pts[0] and pts[-1] must come from E(). both=True only for stores (read+write).
    Returns the arrow's index, for along()."""
    arrows.append((pts, color, dashed, both, width)); return len(arrows) - 1

def label(x, y, s, color=MUTED, anchor="middle", size=10.5):
    """Mono caption BESIDE a line, never on it. Split long labels into two short ones (two calls)."""
    texts.append((x, y, s, color, anchor, size))

def along(a, lines, side=None, seg=None, at=0.5, gap=8, color=None):
    """Label placed beside arrow a (index from arrow()), so it can't land on its line.
    lines: str or tuple of str (stacked). seg: segment index, default the longest. at: 0..1 along it.
    side: above/below for a horizontal segment (default above), left/right for a vertical one (default right).
    Colour defaults to the arrow's. The validator still checks it against every node, line and region border."""
    pts, c = arrows[a][0], color or arrows[a][1]
    segs = list(zip(pts, pts[1:]))
    (x1, y1), (x2, y2) = segs[seg] if seg is not None else max(segs, key=lambda s: abs(s[0][0]-s[1][0]) + abs(s[0][1]-s[1][1]))
    mx, my = x1 + (x2 - x1) * at, y1 + (y2 - y1) * at
    lines, step = ((lines,) if isinstance(lines, str) else tuple(lines)), 14
    if abs(y1 - y2) < .5:
        side = side or "above"
        if side not in ("above", "below"): sys.exit(f"along: side '{side}' on a horizontal segment — use above/below")
        y0 = my - gap - step * (len(lines) - 1) if side == "above" else my + gap + 10.5
        for i, s in enumerate(lines): label(mx, y0 + i * step, s, c)
    else:
        side = side or "right"
        if side not in ("left", "right"): sys.exit(f"along: side '{side}' on a vertical segment — use left/right")
        y0 = my + 4 - step * (len(lines) - 1) / 2
        for i, s in enumerate(lines): label(mx - gap if side == "left" else mx + gap, y0 + i * step, s, c, "end" if side == "left" else "start")

regions, notes = [], []
def region(x, y, w, h, caption, color=BLUE, note=None):
    """Dashed rounded enclosure with a caption top-left and an optional note bottom-right (note is validated like a label)."""
    regions.append((x, y, w, h, caption, color, note))
    if note: label(x + w - 16, y + h - 14, note, MUTED, "end")

legend = []   # (label, color, dashed)

# ══ CONTENT — replace everything in this section ═══════════════════════════════
TITLE, SUBTITLE, EYEBROW, STAMP = "Target Architecture", "example system", "ACME · PROJECT", "2026-01-01"
VW, VH = 1300, 560            # tight to the content — dead margin here is what makes type look small

region(700, 60, 560, 380, "NEW · BUILT IN ACCOUNT B", note="EVERYTHING OUTSIDE IS EXISTING · UNCHANGED")
# Postgres and Redis pick up their logos automatically (exact title match in BRANDS).
node("clients", 40, 160, 150, 200, "Clients", "web · mobile", (), icon="screen")
node("gw", 250, 190, 100, 140, "API", "gateway", ["routes", " by path"], tsize=15)
node("svc", 760, 160, 240, 150, "Orders service", "Go · ECS", ["Owns the order lifecycle", "Publishes events on write"], icon="code", accent=BLUE, fill="#F3F7FF")
node("db", 1080, 170, 130, 110, "Postgres", "RDS", ["orders"], shape="cyl", fill="#F4F3EE")
node("cache", 250, 400, 150, 100, "Redis", "ElastiCache", ["hot reads"], shape="cyl", fill="#F4F3EE")

arrow([E("clients","r",0.5), E("gw","l",ty("gw",260))])                       # level at y=260
a = arrow([E("gw","r",ty("gw",235)), E("svc","l",ty("svc",235))], GREEN, width=2.2) # level at y=235
along(a, "ORDERS · CHECKOUT")                                                   # above the line, in its colour
arrow([E("svc","r",ty("svc",225)), E("db","l",ty("db",225))], BLUE, both=True)
a = arrow([E("gw","b",tx("gw",300)), E("cache","t",tx("cache",300))], both=True) # plumb at x=300
along(a, "GET · SET", color=MUTED)
legend[:] = [("REQUEST PATH", GREEN, False), ("INTERNAL", BLUE, False)]   # add ("…", MUTED, True) only if something IS dashed
# ══ END CONTENT ════════════════════════════════════════════════════════════════

# ── validate ─────────────────────────────────────────────────────────────────
def on_edge(p):
    x, y = p
    for bx, by, bw, bh in nodes.values():
        if (abs(x-bx) < .5 or abs(x-bx-bw) < .5) and by-.5 <= y <= by+bh+.5: return True
        if (abs(y-by) < .5 or abs(y-by-bh) < .5) and bx-.5 <= x <= bx+bw+.5: return True
    return False
def hits(x1, y1, x2, y2, pad=1):
    for n, (bx, by, bw, bh) in nodes.items():
        if max(x1,x2) > bx+pad and min(x1,x2) < bx+bw-pad and max(y1,y2) > by+pad and min(y1,y2) < by+bh-pad: return n
for pts, *_ in arrows:
    if not on_edge(pts[0]): err(f"arrow start off any edge {pts[0]}")
    if not on_edge(pts[-1]): err(f"arrow end off any edge {pts[-1]}")
    for a, b in zip(pts, pts[1:]):
        if abs(a[0]-b[0]) > .5 and abs(a[1]-b[1]) > .5: err(f"segment {a}->{b} is diagonal — align t so both ends share x or y")
        h = hits(*a, *b)
        if h: err(f"segment {a}->{b} crosses {h}")
for x, y, s, c, anchor, size in texts:
    w = len(s) * CHAR["mono"] * size / 10.5
    x1 = {"start": x, "end": x - w, "middle": x - w/2}[anchor]
    h = hits(x1 - 4, y - size - 4, x1 + w + 4, y + 4, pad=0)
    if h: err(f"label '{s}' overlaps or touches {h} (keep ≥4px)")
    for pts, *_ in arrows:
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            if max(ax,bx) >= x1-2 and min(ax,bx) <= x1+w+2 and max(ay,by) >= y-size-2 and min(ay,by) <= y+2:
                err(f"label '{s}' touches line {(ax,ay)}->{(bx,by)} — move it beside the line")
def straddles(x1, y1, x2, y2, rx, ry, rw, rh, pad=3):
    """True when a box crosses a region border — neither clear of the region nor inside it."""
    outside = x2 < rx - pad or x1 > rx + rw + pad or y2 < ry - pad or y1 > ry + rh + pad
    inside = x1 > rx + pad and x2 < rx + rw - pad and y1 > ry + pad and y2 < ry + rh - pad
    return not (outside or inside)
for rx, ry, rw, rh, cap, *_ in regions:
    for x, y, s, c, anchor, size in texts:
        w = len(s) * CHAR["mono"] * size / 10.5
        x1 = {"start": x, "end": x - w, "middle": x - w/2}[anchor]
        if straddles(x1, y - size, x1 + w, y + 2, rx, ry, rw, rh): err(f"label '{s}' crosses the border of region '{cap}' — move it fully inside or outside")
    for n, (bx, by, bw, bh) in nodes.items():
        if straddles(bx, by, bx + bw, by + bh, rx, ry, rw, rh, pad=0): err(f"node {n} straddles the border of region '{cap}' — is it new or not?")
names = list(nodes)
for i, a in enumerate(names):
    ax, ay, aw, ah = nodes[a]
    for b in names[i+1:]:
        bx, by, bw, bh = nodes[b]
        if ax < bx+bw+20 and bx < ax+aw+20 and ay < by+bh+20 and by < ay+ah+20: err(f"nodes closer than 20px: {a} / {b}")
if errs:
    print("VALIDATION FAILED — nothing written"); print("\n".join(" · " + e for e in errs)); sys.exit(1)
print(f"ok · {len(nodes)} nodes · {len(arrows)} arrows · {len(texts)} labels")

# ── emit ─────────────────────────────────────────────────────────────────────
def mk(c): return f'<marker id="m{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9" fill="none" stroke="{c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>'
svg = [f'<svg viewBox="0 0 {VW} {VH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="{TITLE}">',
       '<defs>' + "".join(mk(c) for c in {a[1] for a in arrows}) + '</defs>', '<g font-family="Inter Tight, sans-serif">']
for x, y, w, h, cap, c, note in regions:
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#FBFCFF" stroke="{c}" stroke-width="1.2" stroke-dasharray="7 5"/>')
    svg.append(f'<text x="{x+16}" y="{y+24}" font-family="JetBrains Mono, monospace" font-size="11.5" letter-spacing="1.8" fill="{c}">{cap}</text>')
svg += out
for pts, color, dashed, both, width in arrows:
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    svg.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round" marker-end="url(#m{color[1:]})"{" marker-start=\"url(#m"+color[1:]+")\"" if both else ""}{" stroke-dasharray=\"6 5\"" if dashed else ""}/>')
for x, y, s, c, anchor, size in texts:
    svg.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="JetBrains Mono, monospace" font-size="{size}" letter-spacing="1" fill="{c}">{s}</text>')
lx = 40
for s, c, dsh in legend:
    svg.append(f'<path d="M{lx},{VH-22} h26" stroke="{c}" stroke-width="2.2"{" stroke-dasharray=\"6 5\"" if dsh else ""}/>')
    svg.append(f'<text x="{lx+34}" y="{VH-18}" font-family="JetBrains Mono, monospace" font-size="10.5" letter-spacing="1.2" fill="{MUTED}">{s}</text>')
    lx += 34 + len(s)*7 + 36
svg.append('</g></svg>')

HTML = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{TITLE}</title><link href="{FONTS}" rel="stylesheet"/>
<style>
:root{{--ink:#111;--muted:#5C6066;--muted-2:#8A8F96;--paper:#FFF;--ground:#EFEEE9;--accent:{BLUE};
  --fd:'Inter Tight',-apple-system,sans-serif;--fs:'Source Serif 4',Georgia,serif;--fm:'JetBrains Mono',monospace}}
*{{box-sizing:border-box;margin:0}} html,body{{height:100%}}
body{{background:var(--ground);color:var(--ink);font-family:var(--fd);-webkit-font-smoothing:antialiased;overflow:hidden}}
.frame{{height:100vh;display:flex;flex-direction:column;background:var(--paper);padding:clamp(12px,1.6vh,22px) clamp(16px,1.8vw,34px) clamp(8px,1.1vh,14px);gap:clamp(6px,1vh,12px)}}
.mast{{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;border-bottom:1px solid var(--ink);padding-bottom:clamp(6px,.9vh,11px)}}
.eyebrow{{font-family:var(--fm);font-size:clamp(8px,.92vh,10px);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}}
h1{{font-size:clamp(18px,2.3vh,30px);font-weight:500;letter-spacing:-.028em;line-height:1.03;margin-top:2px}}
h1 em{{font-family:var(--fs);font-style:italic;font-weight:400;color:var(--accent)}}
.stamp{{font-family:var(--fm);font-size:clamp(7px,.85vh,9px);letter-spacing:.1em;text-transform:uppercase;color:var(--muted-2)}}
.canvas{{flex:1 1 auto;min-height:0;display:flex}} svg{{width:100%;height:100%;display:block}}
@media (max-width:1000px),(max-height:600px){{body{{overflow:auto}}.frame{{height:auto;min-height:100vh}}.canvas{{min-height:60vh}}}}
</style></head><body><div class="frame">
<header class="mast"><div><p class="eyebrow">{EYEBROW}</p><h1>{TITLE} — <em>{SUBTITLE}</em></h1></div><div class="stamp">{STAMP}</div></header>
<div class="canvas">
{chr(10).join(svg)}
</div></div></body></html>'''
dest = pathlib.Path(os.environ.get("OUT", pathlib.Path(__file__).with_suffix(".html")))
dest.write_text(HTML); print("wrote", dest)
