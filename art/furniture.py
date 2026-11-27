"""Casino and card-room furniture: the game tables, slot machines, chairs and stools the card and
casino games are played at (world/tables.ts; the client places them, render/gameTables.ts).

Every table is built at a typical real size with its long side along X and the dealer's side
toward -Y; the client stretches each to the table it stands for and turns it to face its dealer
(a slot machine's front, where you stand, is -Y too). The playing surface is material `felt`, a
flat plate whose top is the table's top: the client prints each game's layout on it. Chairs and
stools face +Y (into the table they're pulled up to)."""
import math

import kit
import materials as M

TOP = 0.78  # table height (felt), metres


def stadium(L, W, n=10):
    """A racetrack outline (two half circles joined by straights), counter-clockwise."""
    r = W / 2
    cx = L / 2 - r
    pts = []
    for k in range(n + 1):
        a = -math.pi / 2 + math.pi * k / n
        pts.append((cx + r * math.cos(a), r * math.sin(a)))
    for k in range(n + 1):
        a = math.pi / 2 + math.pi * k / n
        pts.append((-cx + r * math.cos(a), r * math.sin(a)))
    return pts


def rounded(L, W, r, n=4):
    """A rectangle with rounded corners, counter-clockwise."""
    pts = []
    for cx, cy, a0 in ((L / 2 - r, -W / 2 + r, -90), (L / 2 - r, W / 2 - r, 0), (-L / 2 + r, W / 2 - r, 90), (-L / 2 + r, -W / 2 + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def inset(poly, d):
    """The outline moved in by d (good enough for convex outlines: each point toward the middle)."""
    out = []
    k = len(poly)
    for i, (x, y) in enumerate(poly):
        px, py = poly[i - 1]
        nx, ny = poly[(i + 1) % k]
        # Average of the two edges' inward normals (counter-clockwise: inward is to the left).
        e1 = (x - px, y - py)
        e2 = (nx - x, ny - y)
        n1 = (-e1[1], e1[0])
        n2 = (-e2[1], e2[0])
        l1 = math.hypot(*n1) or 1
        l2 = math.hypot(*n2) or 1
        mx, my = n1[0] / l1 + n2[0] / l2, n1[1] / l1 + n2[1] / l2
        lm = math.hypot(mx, my) or 1
        out.append((x + mx / lm * d, y + my / lm * d))
    return out


def ring(name, path, profile, col, mat, closed=True):
    """A cross-section [(out, up)] swept round a level outline (a padded rail): `out` is measured
    outward (to the right of a counter-clockwise path)."""
    pts = path + ([path[0]] if closed else [])
    rings = []
    m = len(path)
    for i, (x, y) in enumerate(pts):
        if closed:
            a, b = path[(i - 1) % m], path[(i + 1) % m]
        else:
            a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        tl = math.hypot(tx, ty) or 1
        sx, sy = ty / tl, -tx / tl
        rings.append([(x + sx * o, y + sy * o, u) for o, u in profile])
    v, f = kit.loft(rings, cap0=not closed, cap1=not closed)
    return kit.recalc(kit.mesh(name, v, f, col, mat, smooth=True, sharp=50))


def cushion(z, w=0.15, h=0.09):
    """A padded armrest's cross-section, sitting on z."""
    hw = w / 2
    return [(-hw, z), (hw, z), (hw, z + h * 0.45), (hw * 0.6, z + h * 0.9), (0, z + h), (-hw * 0.6, z + h * 0.9), (-hw, z + h * 0.45)]


def pedestal(x, y, col, top, mat="wood_dark", r=0.12):
    """A turned pedestal with a spread foot."""
    return kit.lathe("pedestal", [(0, 0.32), (0.04, 0.32), (0.07, r * 1.1), (0.14, r * 0.7), (top - 0.12, r * 0.6), (top - 0.06, r), (top, r)],
                     col, M.get(mat), n=16, axis='Z', at=(x, y, 0))


def leg(x, y, col, top, mat="wood_dark"):
    """A turned table leg."""
    return kit.lathe("leg", [(0, 0.035), (0.08, 0.045), (0.12, 0.03), (top * 0.55, 0.042), (top * 0.62, 0.05), (top * 0.68, 0.035), (top, 0.04)],
                     col, M.get(mat), n=10, axis='Z', at=(x, y, 0))


def felt(name, poly, col, z=TOP):
    return kit.plan_prism(name, poly, z - 0.04, z, col, M.get("felt"))


def chip_rack(x, y, w, col, slots=8):
    """The dealer's chip tray: a lacquered tray with brass dividers and chips in the rows."""
    out = [kit.box("rack", x - w / 2, x + w / 2, y - 0.08, y + 0.08, TOP, TOP + 0.04, col, M.get("lacquer"), bev=0.01)]
    colours = ["red", "white", "navy", "yellow", "olive", "pink", "red", "white"]
    for k in range(slots):
        cx = x - w / 2 + w * (k + 0.5) / slots
        out.append(kit.box("chips", cx - w / slots * 0.38, cx + w / slots * 0.38, y - 0.065, y + 0.065, TOP + 0.01, TOP + 0.045, col, M.get(colours[k % len(colours)])))
    return out


def poker_oval(col):
    """A casino poker table: a racetrack of felt inside a padded black rail, a wooden apron, two
    pedestals, and the dealer's chip tray in a cut in the rail on the -Y side."""
    L, W = 2.7, 1.5
    out = [kit.plan_prism("apron", stadium(L, W), TOP - 0.16, TOP - 0.03, col, M.get("wood_dark"))]
    out.append(felt("felt", stadium(L - 0.3, W - 0.3), col))
    out.append(ring("rail", inset(stadium(L, W), 0.085), cushion(TOP - 0.04), col, M.get("leather_black")))
    out.append(ring("trim", inset(stadium(L, W), 0.17), [(-0.012, TOP - 0.035), (0.012, TOP - 0.035), (0.012, TOP + 0.006), (-0.012, TOP + 0.006)], col, M.get("wood")))
    out += chip_rack(0, -W / 2 + 0.26, 0.55, col)
    for x in (-0.6, 0.6):
        out.append(pedestal(x, 0, col, TOP - 0.16))
    # A deck by the dealer, cards out on the felt.
    out.append(kit.box("deck", 0.4, 0.49, -W / 2 + 0.22, -W / 2 + 0.34, TOP, TOP + 0.02, col, M.get("navy")))
    for k in range(3):
        out.append(kit.box("card", -0.25 + k * 0.1, -0.17 + k * 0.1, -0.06, 0.06, TOP, TOP + 0.004, col, M.get("white")))
    return out


def half_moon(L, W, n=16):
    """A blackjack table's outline: flat along -Y (the dealer), round toward +Y."""
    pts = [(L / 2 * math.cos(math.pi * k / n), -W / 2 + W * math.sin(math.pi * k / n)) for k in range(n + 1)]
    return pts[::-1][::-1]


def blackjack(col, wood=False):
    """A blackjack (or twenty-one) table: a half moon with the rail round the curve, the chip rack,
    the shoe and the discard holder along the dealer's flat side."""
    L, W = 2.2, 1.25
    outline = half_moon(L, W)
    rail = "wood_dark" if wood else "leather_black"
    out = [kit.plan_prism("apron", outline, TOP - 0.16, TOP - 0.03, col, M.get("wood_dark" if not wood else "wood"))]
    out.append(felt("felt", inset(outline, 0.12), col))
    arc = [(x, y) for x, y in inset(outline, 0.075)][1:-1]
    out.append(ring("rail", arc, cushion(TOP - 0.04, 0.13 if not wood else 0.1, 0.08 if not wood else 0.05), col, M.get(rail), closed=False))
    out.append(kit.box("lip", -L / 2, L / 2, -W / 2, -W / 2 + 0.06, TOP - 0.04, TOP + 0.02, col, M.get("wood_dark")))
    out += chip_rack(0, -W / 2 + 0.17, 0.6, col)
    out.append(kit.box("shoe", 0.55, 0.75, -W / 2 + 0.1, -W / 2 + 0.24, TOP, TOP + 0.1, col, M.get("lacquer"), bev=0.015))
    out.append(kit.box("discard", -0.75, -0.6, -W / 2 + 0.1, -W / 2 + 0.22, TOP, TOP + 0.07, col, M.get("glass" if not wood else "wood"), bev=0.01))
    if wood:
        for x, y in ((-0.8, -0.45), (0.8, -0.45), (-0.4, 0.4), (0.4, 0.4)):
            out.append(leg(x, y, col, TOP - 0.16, "wood"))
    else:
        for x in (-0.5, 0.5):
            out.append(pedestal(x, -0.15, col, TOP - 0.16))
    return out


def roulette(col):
    """A roulette table: the wheel in its bowl at the -X end, the betting layout on felt along the
    rest, inside a wooden rail."""
    L, W = 3.0, 1.45
    out = [kit.plan_prism("body", rounded(L, W, 0.12), TOP - 0.18, TOP - 0.03, col, M.get("wood_dark"))]
    out.append(felt("felt", rounded(L - 0.16, W - 0.16, 0.06), col))
    out.append(ring("rail", inset(rounded(L, W, 0.12), 0.05), cushion(TOP - 0.04, 0.1, 0.05), col, M.get("wood")))
    # The wheel: a wooden bowl, the ball track, the coloured pockets, and the brass turret.
    wx = -L / 2 + 0.55
    out.append(kit.lathe("bowl", [(0, 0.5), (0.1, 0.52), (0.13, 0.49), (0.11, 0.42), (0.06, 0.37)], col, M.get("wood"), n=40, axis='Z', at=(wx, 0, TOP - 0.04)))
    out.append(kit.lathe("track", [(0.0, 0.42), (0.045, 0.37), (0.04, 0.3)], col, M.get("wood_dark"), n=40, axis='Z', at=(wx, 0, TOP + 0.02), caps=False))
    for k in range(38):
        a0, a1 = 2 * math.pi * k / 38, 2 * math.pi * (k + 1) / 38
        mat = "green" if k in (0, 19) else ("red" if k % 2 else "lacquer")
        poly = [(wx + r * math.cos(a), r * math.sin(a)) for r, a in ((0.2, a0), (0.3, a0), (0.3, a1), (0.2, a1))]
        out.append(kit.plan_prism("pocket", poly, TOP + 0.03, TOP + 0.05, col, M.get(mat)))
    out.append(kit.lathe("cone", [(0, 0.2), (0.05, 0.16), (0.09, 0.06), (0.1, 0.04)], col, M.get("wood"), n=24, axis='Z', at=(wx, 0, TOP + 0.03)))
    out.append(kit.lathe("turret", [(0, 0.035), (0.08, 0.025), (0.12, 0.04), (0.15, 0.0)], col, M.get("brass"), n=12, axis='Z', at=(wx, 0, TOP + 0.1)))
    for k in range(4):
        a = math.pi / 2 * k
        out.append(kit.tube("arm", [(wx, 0, TOP + 0.2), (wx + 0.11 * math.cos(a), 0.11 * math.sin(a), TOP + 0.2)], 0.012, col, M.get("brass"), n=6))
    out.append(kit.lathe("ball", [(-0.012, 0.0), (-0.009, 0.009), (0, 0.012), (0.009, 0.009), (0.012, 0.0)], col, M.get("white"), n=8, axis='Z', at=(wx + 0.36, 0.1, TOP + 0.07)))
    # Stacks of the players' colour chips on the layout, the dolly beside them.
    for x, y, c in ((0.2, 0.25, "pink"), (0.6, -0.1, "yellow"), (0.9, 0.3, "navy")):
        out.append(kit.lathe("stack", [(0, 0.025), (0.05, 0.025)], col, M.get(c), n=10, axis='Z', at=(x, y, TOP)))
    for x in (-L / 2 + 0.3, L / 2 - 0.3):
        for y in (-W / 2 + 0.25, W / 2 - 0.25):
            out.append(leg(x, y, col, TOP - 0.18))
    return out


def craps(col):
    """A craps table: a long tub with high padded walls, chip grooves along the top, the felt
    bottom (the layout's printed on it), the boxman's tray in the middle of the -Y side, the dice."""
    L, W = 3.8, 1.8
    out = [kit.plan_prism("body", rounded(L, W, 0.4, 6), 0.0, TOP - 0.12, col, M.get("wood_dark"))]
    out.append(felt("felt", rounded(L - 0.3, W - 0.3, 0.3, 6), col, TOP - 0.1))
    wall = inset(rounded(L, W, 0.4, 6), 0.08)
    out.append(ring("wall", wall, [(-0.08, TOP - 0.12), (0.08, TOP - 0.12), (0.08, TOP + 0.12), (-0.08, TOP + 0.12)], col, M.get("wood_dark")))
    out.append(ring("rail", inset(rounded(L, W, 0.4, 6), 0.06), cushion(TOP + 0.12, 0.13, 0.07), col, M.get("leather_black")))
    out.append(ring("groove", inset(rounded(L, W, 0.4, 6), 0.165), [(-0.03, TOP + 0.1), (0.03, TOP + 0.1), (0.03, TOP + 0.125), (-0.03, TOP + 0.125)], col, M.get("lacquer")))
    out += chip_rack(0, -W / 2 + 0.3, 0.7, col)
    for x, s in ((0.3, 0.0), (0.38, 0.6)):
        d = kit.box("die", -0.02, 0.02, -0.02, 0.02, -0.02, 0.02, col, M.get("red"), bev=0.006)
        kit.place(d, (x, 0.2, TOP - 0.08), (0, 0, s))
        out.append(d)
    return out


def slots(col):
    """A slot machine, its front toward -Y: a red cabinet, the glass over the reels, the topper
    sign, the button deck, the coin tray and the chrome handle on its right."""
    D, Wd = 0.62, 0.68
    # Side profile [(depth, z)]: depth 0 at the front.
    prof = [(0, 0), (D, 0), (D, 1.86), (0.12, 1.86), (0.08, 1.48), (0.14, 1.42), (0.06, 0.92), (-0.08, 0.84), (-0.08, 0.78), (0, 0.76)]
    cab = kit.prism("cabinet", [(d, z) for d, z in prof], -Wd / 2, Wd / 2, col, M.get("red"), bev=0.01)
    # The prism is built across Y with depth along X: turn it so the front looks down -Y.
    kit.place(cab, (0, -D / 2, 0), (0, 0, math.pi / 2))
    out = [cab]
    # The reel glass, tilted back like the face it sits on.
    face = kit.box("screen", -Wd / 2 + 0.07, Wd / 2 - 0.07, -0.012, 0.0, 0.0, 0.46, col, M.get("screen"))
    kit.place(face, (0, -D / 2 + 0.064, 0.94), (math.radians(-9), 0, 0))
    out.append(face)
    sign = kit.box("topper", -Wd / 2 + 0.04, Wd / 2 - 0.04, -0.01, 0.0, 0.0, 0.3, col, M.get("sign"))
    kit.place(sign, (0, -D / 2 + 0.083, 1.52), (math.radians(-6), 0, 0))
    out.append(sign)
    out.append(kit.box("deck", -Wd / 2 + 0.02, Wd / 2 - 0.02, -D / 2 - 0.08, -D / 2 + 0.02, 0.78, 0.82, col, M.get("lacquer"), bev=0.01))
    for k, c in enumerate(("yellow", "white", "red")):
        x = -0.18 + k * 0.12
        out.append(kit.box("button", x - 0.04, x + 0.04, -D / 2 - 0.06, -D / 2 - 0.02, 0.82, 0.84, col, M.get(c)))
    out.append(kit.box("tray", -0.2, 0.2, -D / 2 - 0.06, -D / 2 + 0.01, 0.12, 0.2, col, M.get("stainless"), bev=0.01))
    out.append(kit.box("plinth", -Wd / 2 - 0.01, Wd / 2 + 0.01, -D / 2 - 0.01, D / 2 + 0.01, 0, 0.08, col, M.get("lacquer")))
    for z in (1.86, 1.47, 0.76):
        out.append(kit.box("trim", -Wd / 2 - 0.006, Wd / 2 + 0.006, -D / 2 - 0.006, -D / 2 + 0.03, z - 0.02, z + 0.005, col, M.get("chrome")))
    hx = Wd / 2 + 0.05
    out.append(kit.box("boss", Wd / 2, hx + 0.02, -0.08, 0.08, 1.0, 1.12, col, M.get("chrome"), bev=0.01))
    out.append(kit.tube("handle", [(hx, 0, 1.06), (hx + 0.02, -0.08, 1.3), (hx + 0.02, -0.12, 1.42)], 0.018, col, M.get("chrome")))
    out.append(kit.lathe("knob", [(-0.045, 0.0), (-0.03, 0.035), (0, 0.045), (0.03, 0.035), (0.045, 0.0)], col, M.get("red"), n=12, axis='Z', at=(hx + 0.02, -0.12, 1.45)))
    return out


def stool(col):
    """A slot stool: a round padded seat on a chrome column, a foot ring."""
    out = [kit.lathe("seat", [(0, 0.0), (0.0, 0.2), (0.05, 0.21), (0.09, 0.19), (0.1, 0.0)], col, M.get("leather_black"), n=16, axis='Z', at=(0, 0, 0.62))]
    out.append(kit.lathe("column", [(0, 0.03), (0.62, 0.03)], col, M.get("chrome"), n=8, axis='Z'))
    out.append(kit.lathe("foot", [(0, 0.2), (0.02, 0.2), (0.05, 0.05)], col, M.get("chrome"), n=16, axis='Z'))
    pts = [(0.17 * math.cos(2 * math.pi * k / 12), 0.17 * math.sin(2 * math.pi * k / 12), 0.3) for k in range(13)]
    out.append(kit.tube("ring", pts, 0.012, col, M.get("chrome"), n=6, caps=False))
    return out


def chair(col, wood=False):
    """A card-table chair facing +Y: a padded seat and back on four legs (wood: a saloon's)."""
    seat, back, legs = ("wood", "wood", "wood_dark") if wood else ("leather_black", "leather_black", "chrome")
    out = [kit.box("seat", -0.22, 0.22, -0.22, 0.2, 0.44, 0.5, col, M.get(seat), bev=0.03)]
    out.append(kit.box("back", -0.21, 0.21, -0.25, -0.19, 0.5, 0.92, col, M.get(back), bev=0.025))
    for x in (-0.18, 0.18):
        for y in (-0.19, 0.17):
            out.append(kit.box("leg", x - 0.02, x + 0.02, y - 0.02, y + 0.02, 0, 0.45, col, M.get(legs)))
    return out


def card_table(col):
    """A plain card table (a saloon's, a back room's): a wooden top with a felt inset, a skirt and
    four turned legs."""
    L, W = 2.0, 1.2
    out = [kit.box("top", -L / 2, L / 2, -W / 2, W / 2, TOP - 0.05, TOP - 0.01, col, M.get("wood_dark"), bev=0.015)]
    out.append(felt("felt", rounded(L - 0.24, W - 0.24, 0.04), col, TOP))
    out.append(kit.box("skirt", -L / 2 + 0.08, L / 2 - 0.08, -W / 2 + 0.08, W / 2 - 0.08, TOP - 0.16, TOP - 0.05, col, M.get("wood_dark")))
    for x in (-L / 2 + 0.12, L / 2 - 0.12):
        for y in (-W / 2 + 0.12, W / 2 - 0.12):
            out.append(leg(x, y, col, TOP - 0.05))
    out.append(kit.box("deck", -0.05, 0.05, -0.07, 0.07, TOP, TOP + 0.02, col, M.get("navy")))
    return out


def faro(col):
    """A faro table: a card table with the dealer's box and the casekeeper (the abacus that counts
    the cards out) on the -Y side."""
    out = card_table(col)
    W = 1.2
    out.append(kit.box("dealbox", -0.06, 0.06, -W / 2 + 0.16, -W / 2 + 0.3, TOP, TOP + 0.06, col, M.get("stainless"), bev=0.008))
    out.append(kit.box("casekeeper", 0.35, 0.75, -W / 2 + 0.13, -W / 2 + 0.33, TOP, TOP + 0.03, col, M.get("wood"), bev=0.008))
    for k in range(4):
        y = -W / 2 + 0.16 + k * 0.045
        out.append(kit.tube("wire", [(0.37, y, TOP + 0.04), (0.73, y, TOP + 0.04)], 0.004, col, M.get("brass"), n=4))
        for b in range(4):
            x = 0.4 + b * 0.03 + (0.1 if b > 1 else 0)
            out.append(kit.box("bead", x - 0.012, x + 0.012, y - 0.014, y + 0.014, TOP + 0.03, TOP + 0.055, col, M.get("lacquer")))
    return out


def dice_table(col):
    """A hazard table: a card table with a raised board round the felt to throw against."""
    out = card_table(col)
    L, W = 2.0, 1.2
    for x0, x1, y0, y1 in ((-L / 2 + 0.08, L / 2 - 0.08, -W / 2 + 0.08, -W / 2 + 0.12), (-L / 2 + 0.08, L / 2 - 0.08, W / 2 - 0.12, W / 2 - 0.08),
                           (-L / 2 + 0.08, -L / 2 + 0.12, -W / 2 + 0.08, W / 2 - 0.08), (L / 2 - 0.12, L / 2 - 0.08, -W / 2 + 0.08, W / 2 - 0.08)):
        out.append(kit.box("board", x0, x1, y0, y1, TOP - 0.01, TOP + 0.1, col, M.get("wood")))
    for x, s in ((0.2, 0.0), (0.27, 0.5)):
        d = kit.box("die", -0.018, 0.018, -0.018, 0.018, -0.018, 0.018, col, M.get("white"), bev=0.005)
        kit.place(d, (x, 0.15, TOP + 0.018), (0, 0, s))
        out.append(d)
    return out


def folding(col):
    """A folding card table out in a yard: a thin top with a vinyl-green playing surface on steel legs."""
    L, W = 1.9, 1.1
    out = [kit.box("top", -L / 2, L / 2, -W / 2, W / 2, TOP - 0.04, TOP - 0.01, col, M.get("trim"), bev=0.01)]
    out.append(felt("felt", rounded(L - 0.08, W - 0.08, 0.03), col, TOP))
    for x in (-L / 2 + 0.06, L / 2 - 0.06):
        for y in (-W / 2 + 0.06, W / 2 - 0.06):
            out.append(kit.tube("leg", [(x, y, 0), (x, y, TOP - 0.04)], 0.014, col, M.get("steel"), n=6))
    out.append(kit.box("deck", -0.05, 0.05, -0.07, 0.07, TOP, TOP + 0.02, col, M.get("red")))
    return out


MODELS = {
    "poker_oval": poker_oval, "blackjack": blackjack, "blackjack_wood": lambda c: blackjack(c, wood=True),
    "roulette": roulette, "craps": craps, "slots": slots, "stool": stool, "chair": chair,
    "chair_wood": lambda c: chair(c, wood=True), "card_table": card_table, "faro": faro, "dice_table": dice_table, "folding": folding,
}


def build(mid, col):
    return MODELS[mid](col)
