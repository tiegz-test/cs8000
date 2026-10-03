"""Generate map.svg: a procedural fantasy map. Usage: python3 tools/gen_map.py > map.svg"""
import math, random

random.seed(8000)
W, H = 1600, 1000


def blob(cx, cy, r, n=48, rough=0.35):
    """Closed, wobbly coastline as a smooth path."""
    phases = [(random.uniform(0, 6.28), random.randint(2, 7), random.uniform(0.3, 1)) for _ in range(5)]
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rough * sum(amp * math.sin(f * a + p) for p, f, amp in phases) / 3
        pts.append((cx + r * k * math.cos(a) * 1.25, cy + r * k * math.sin(a)))
    d = f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d + "Z", pts


def inside(pt, poly):
    x, y = pt
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i - 1]
        x2, y2 = poly[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


lands = [(620, 520, 300, 0.38), (1180, 380, 200, 0.4), (1280, 780, 130, 0.35),
         (230, 250, 130, 0.4), (300, 800, 90, 0.35), (900, 860, 70, 0.3), (880, 160, 80, 0.35)]
paths, polys = [], []
for cx, cy, r, ro in lands:
    d, pts = blob(cx, cy, r, rough=ro)
    paths.append(d)
    polys.append(pts)


def on_land(x, y, shrink=1.0):
    return any(inside((x, y), p) for p in polys)


out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">']
out.append('''<defs>
<filter id="paper" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="5" seed="4" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.33  0 0 0 0 0.15  0 0 0 0.55 -0.1"/>
</filter>
<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="9"/>
  <feDisplacementMap in="SourceGraphic" scale="7"/></filter>
<radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset="60%" stop-color="#5a3a14" stop-opacity="0"/>
  <stop offset="100%" stop-color="#3a2208" stop-opacity="0.65"/></radialGradient>
<pattern id="wave" width="40" height="22" patternUnits="userSpaceOnUse">
  <path d="M0,11 q10,-8 20,0 t20,0" fill="none" stroke="#6b8a8c" stroke-width="1" opacity=".35"/></pattern>
</defs>''')
out.append(f'<rect width="{W}" height="{H}" fill="#cfe0d4"/>')
out.append(f'<rect width="{W}" height="{H}" fill="url(#wave)"/>')
# coast: wide soft halo, then land
out.append('<g filter="url(#rough)">')
for d in paths:
    out.append(f'<path d="{d}" fill="none" stroke="#6b8a8c" stroke-width="26" opacity=".12"/>')
    out.append(f'<path d="{d}" fill="none" stroke="#6b8a8c" stroke-width="14" opacity=".18"/>')
for d in paths:
    out.append(f'<path d="{d}" fill="#e6d3a3" stroke="#4a3418" stroke-width="2.5"/>')
out.append('</g>')

# forests (small trees), mountains
def tree(x, y):
    return f'<path d="M{x},{y-9} l5,10 h-10z" fill="#4f7a3a" stroke="#2f4a22" stroke-width=".8"/>'

def mountain(x, y, s):
    return (f'<path d="M{x-s},{y} L{x},{y-s*1.3} L{x+s},{y} Z" fill="#b9a276" stroke="#4a3418" stroke-width="1.4"/>'
            f'<path d="M{x},{y-s*1.3} L{x+s},{y} L{x+s*0.2},{y} Z" fill="#8a7550" opacity=".7"/>')

def sample(cx, cy, r, n):
    got = []
    tries = 0
    while len(got) < n and tries < 4000:
        tries += 1
        x, y = cx + random.uniform(-1.5, 1.5) * r, cy + random.uniform(-1.2, 1.2) * r
        if on_land(x, y) and all(on_land(x + dx, y + dy) for dx, dy in ((18, 0), (-18, 0), (0, 18), (0, -18))):
            got.append((x, y))
    return got

feat = []
for cx, cy, r, _ in lands[:4]:
    # mountain ridge along a random line
    ang = random.uniform(0, math.pi)
    for p in sample(cx, cy, r * 0.7, int(r / 9)):
        feat.append(("m", p[1], mountain(p[0], p[1], random.uniform(10, 20))))
    for p in sample(cx, cy, r, int(r / 3)):
        feat.append(("t", p[1], tree(*p)))
for _, _, s in sorted(feat, key=lambda f: f[1]):
    out.append(s)

# rivers from the big island's interior to the sea
def river(x, y, dx, dy):
    d = f"M{x},{y}"
    for _ in range(60):
        dx += random.uniform(-.5, .5); dy += random.uniform(-.5, .5)
        x += dx * 8; y += dy * 8
        d += f" L{x:.0f},{y:.0f}"
        if not on_land(x, y):
            break
    return f'<path d="{d}" fill="none" stroke="#6b97b0" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>'
out.append(river(640, 500, -1, 0.3))
out.append(river(660, 520, 0.4, 1))
out.append(river(1190, 370, 1, -0.2))

# towns
def town(x, y, name, big=False):
    s = 6 if big else 4
    return (f'<circle cx="{x}" cy="{y}" r="{s}" fill="#8b1a1a" stroke="#2b1a08" stroke-width="1.5"/>'
            f'<text x="{x+s+5}" y="{y+4}" font-family="Georgia,serif" font-style="italic" font-size="{16 if big else 13}" '
            f'fill="#2b1a08">{name}</text>')
out += [town(590, 470, "Aldermere", True), town(760, 600, "Port Veil"), town(480, 600, "Thornwick"),
        town(1170, 350, "Kharazûn", True), town(1280, 790, "Ember Hold"), town(235, 255, "Frostreach")]

# sea labels / region names
def label(x, y, t, size, rot=0, spacing=8, op=.55):
    return (f'<text x="{x}" y="{y}" transform="rotate({rot} {x} {y})" text-anchor="middle" font-family="Georgia,serif" '
            f'font-size="{size}" letter-spacing="{spacing}" fill="#2f4d52" opacity="{op}">{t}</text>')
out += [label(1060, 700, "THE WHISPERING SEA", 30, -6), label(380, 480, "MISTRAL", 22, -90, 14),
        label(1430, 580, "SERPENT'S REACH", 26, 80, 8), label(620, 380, "THE VALE OF ASH", 24, 0, 10, .45).replace("#2f4d52", "#4a3418"),
        label(900, 920, "Sea of Storms", 28, 0, 6)]

# sea monster
out.append('<g fill="none" stroke="#2f4d52" stroke-width="2.5" stroke-linecap="round" opacity=".7" transform="translate(1000 640)">'
           '<path d="M0,0 q10,-30 20,0"/><path d="M40,0 q10,-30 20,0"/><path d="M80,0 q10,-30 20,0"/>'
           '<path d="M100,0 q10,-20 20,-45 q4,-10 14,-8"/><circle cx="136" cy="-52" r="1.5"/></g>')

# compass rose
cx, cy = 1450, 150
out.append(f'<g transform="translate({cx} {cy})" stroke="#2b1a08" stroke-width="1.5">')
out.append('<circle r="62" fill="none" opacity=".6"/><circle r="52" fill="none" opacity=".4"/>')
for a, l in ((0, 80), (90, 80), (180, 80), (270, 80), (45, 50), (135, 50), (225, 50), (315, 50)):
    out.append(f'<path d="M0,0 L{-7},{-14} L0,{-l} L7,-14Z" fill="{"#8b1a1a" if a == 0 else "#e6d3a3"}" transform="rotate({a})"/>')
out.append('<text y="-92" text-anchor="middle" font-family="Georgia,serif" font-size="22" fill="#2b1a08" stroke="none">N</text></g>')

# title cartouche
out.append('<g transform="translate(60 70)"><text font-family="Georgia,serif" font-size="46" font-weight="bold" fill="#2b1a08" '
           'letter-spacing="3">The Realm of Eldoria</text><path d="M0,16 H420" stroke="#2b1a08" stroke-width="2"/></g>')

# border, paper texture, vignette
out.append(f'<rect width="{W}" height="{H}" filter="url(#paper)" style="mix-blend-mode:multiply"/>')
out.append(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
out.append(f'<rect x="18" y="18" width="{W-36}" height="{H-36}" fill="none" stroke="#2b1a08" stroke-width="4"/>')
out.append(f'<rect x="28" y="28" width="{W-56}" height="{H-56}" fill="none" stroke="#2b1a08" stroke-width="1.2"/>')
out.append('</svg>')
print("\n".join(out))
