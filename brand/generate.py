# Generates the refined MNS Tech marks: a monoline ">_ mns.tech" drawn on a 10-unit x-height grid.
import json, sys
SW = 2.1  # stroke width
G = {  # glyph: (width, path relative to x=0, baseline y=24, x-height top y=14)
 'm': (12.4, "M0 24V17.4A3.1 3.4 0 0 1 6.2 17.4V24M6.2 17.4A3.1 3.4 0 0 1 12.4 17.4V24"),
 'n': (7,  "M0 24V17.5A3.5 3.5 0 0 1 7 17.5V24"),
 's': (7,  "M6.7 15.7C6 14.5 4.9 14 3.6 14C1.6 14 0.3 15 0.3 16.6C0.3 18.2 1.7 18.7 3.6 19C5.6 19.3 7 19.9 7 21.5C7 23.1 5.6 24 3.5 24C2 24 0.9 23.5 0.2 22.4"),
 't': (6.4,"M2.3 10.6V21.3A2.7 2.7 0 0 0 5 24H6.4M0 14.2H6.2"),
 'e': (7.2,"M0.2 19H7.2A3.6 5 0 1 0 6.3 22.6"),
 'c': (7,  "M6.7 16.1A3.5 5 0 1 0 6.7 21.9"),
 'h': (7,  "M0 9.6V24M0 17.5A3.5 3.5 0 0 1 7 17.5V24"),
}
GAP = {'m':2.7,'n':2.7,'s':1.9,'.':1.7,'t':2.0,'e':2.4,'c':2.4,'h':0}
def word(x0):
    paths=[]; x=x0; dot=None
    for ch in "mns.tech":
        if ch=='.':
            dot=(x+1.45, 22.9); x+=2.9+GAP['.']; continue
        w,d=G[ch]; paths.append((x,d)); x+=w+GAP[ch]
    return paths, dot, x
PROMPT = "M0 12.6L5.6 18L0 23.4M8.4 24H15.4"
def svg(fg, accent, bg=None, pad=4, animated=False):
    pw, gap = 15.4, 7.2
    paths, dot, end = word(pw+gap)
    W = end + 2*pad; H = 9.6-3 + 0  # placeholder
    top, bottom = 7, 27
    vb = f"{-pad} {top} {W} {bottom-top}"
    body = []
    if bg: body.append(f'<rect x="{-pad}" y="{top}" width="{W}" height="{bottom-top}" rx="3" fill="{bg}"/>')
    cur = '<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.1s" repeatCount="indefinite"/>' if animated else ''
    body.append(f'<path d="M0 12.6L5.6 18L0 23.4" stroke="{accent}"/>')
    body.append(f'<path d="M8.4 24H15.4" stroke="{accent}">{cur}</path>')
    body.append(f'<g stroke="{fg}">' + "".join(f'<path transform="translate({x:.2f} 0)" d="{d}"/>' for x,d in paths) + '</g>')
    body.append(f'<circle cx="{dot[0]:.2f}" cy="{dot[1]}" r="1.45" fill="{accent}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{W*10:.0f}" height="{(bottom-top)*10:.0f}" role="img" aria-label="mns.tech">'
            f'<title>mns.tech</title><g fill="none" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round">' + "".join(body) + '</g></svg>')
def icon(accent, bg):
    # 32×32 tile: the prompt alone, centred, a little heavier.
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="512" height="512" role="img" aria-label="mns.tech">'
            f'<title>mns.tech</title><rect width="32" height="32" rx="7" fill="{bg}"/>'
            f'<g fill="none" stroke="{accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(7.6 -2)">'
            '<path d="M0 12.6L5.6 18L0 23.4"/><path d="M8.4 24H15.4"/></g></svg>')
out = sys.argv[1]
LIME, BLUE, INK, PAPER = '#c8ff3e', '#1555d6', '#0b0d10', '#f3f5f1'
files = {
 'mns-tech-dark.svg': svg(PAPER, LIME),
 'mns-tech-dark-bg.svg': svg(PAPER, LIME, bg=INK),
 'mns-tech-light.svg': svg(INK, BLUE),
 'mns-tech-animated.svg': svg(PAPER, LIME, bg=INK, animated=True),
 'mns-tech-icon.svg': icon(LIME, INK),
}
for n,c in files.items(): open(f"{out}/{n}","w").write(c+"\n")
# Path data for the CubeVision reveal (particles trace these lines).
paths, dot, end = word(15.4+7.2)
data = {"width": end, "paths": ["M0 12.6L5.6 18L0 23.4","M8.4 24H15.4"] + [f"M{0}" and d for x,d in []]}
segs = [{"x":0,"d":"M0 12.6L5.6 18L0 23.4"},{"x":0,"d":"M8.4 24H15.4"}] + [{"x":round(x,2),"d":d} for x,d in paths]
json.dump({"width": round(end,2), "top": 9.6, "bottom": 24, "paths": segs, "dot": [round(dot[0],2), dot[1], 1.45]}, open(f"{out}/mark.json","w"), indent=1)
print('ok', round(end,2))
