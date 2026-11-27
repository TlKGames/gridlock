"""Named materials. The game reads each material's name (weapons: the gun shop's looks) or its role
(vehicles: how the part is drawn), so names and roles are the contract with the client.

Vehicle roles: paint (tinted by the car's colour), fixed (keeps its colour, baked to vertex colours),
shiny (glass and chrome: the mirror-like material), head / tail (lamp lenses that light up at
night), siren_red / siren_blue (light bar halves that flash).
"""
import bpy

# name: (sRGB colour, metallic, roughness, role)
PALETTE = {
    # vehicles
    # Paint is tinted per car in the game; red here so models read as cars in review.
    "paint":      ((0.60, 0.10, 0.08), 0.35, 0.32, "paint"),
    "trim":       ((0.07, 0.07, 0.08), 0.10, 0.65, "fixed"),
    "grille":     ((0.035, 0.035, 0.04), 0.30, 0.55, "fixed"),
    "tyre":       ((0.05, 0.05, 0.05), 0.00, 0.90, "fixed"),
    "rim":        ((0.62, 0.64, 0.66), 0.90, 0.30, "fixed"),
    "rim_dark":   ((0.16, 0.16, 0.17), 0.80, 0.40, "fixed"),
    "underbody":  ((0.09, 0.09, 0.10), 0.20, 0.80, "fixed"),
    "interior":   ((0.12, 0.11, 0.11), 0.00, 0.80, "fixed"),
    "seat":       ((0.20, 0.17, 0.15), 0.00, 0.75, "fixed"),
    "plate":      ((0.88, 0.86, 0.74), 0.10, 0.50, "fixed"),
    "amber":      ((0.95, 0.52, 0.08), 0.10, 0.30, "fixed"),
    "white":      ((0.90, 0.90, 0.88), 0.20, 0.40, "fixed"),
    "red":        ((0.72, 0.07, 0.06), 0.20, 0.40, "fixed"),
    "navy":       ((0.08, 0.15, 0.30), 0.30, 0.40, "fixed"),
    "pink":       ((0.98, 0.55, 0.76), 0.20, 0.40, "fixed"),
    "yellow":     ((0.92, 0.70, 0.08), 0.20, 0.45, "fixed"),
    "olive":      ((0.29, 0.32, 0.20), 0.10, 0.75, "fixed"),
    "canvas":     ((0.33, 0.33, 0.22), 0.00, 0.90, "fixed"),
    "steel":      ((0.45, 0.46, 0.48), 0.85, 0.40, "fixed"),
    "stainless":  ((0.70, 0.71, 0.72), 0.85, 0.32, "fixed"),
    "chrome":     ((0.85, 0.87, 0.90), 1.00, 0.08, "shiny"),
    "glass":      ((0.10, 0.13, 0.16), 0.10, 0.05, "shiny"),
    "head":       ((0.95, 0.94, 0.86), 0.20, 0.10, "head"),
    "tail":       ((0.70, 0.05, 0.05), 0.20, 0.20, "tail"),
    "siren_red":  ((0.90, 0.10, 0.10), 0.10, 0.20, "siren_red"),
    "siren_blue": ((0.15, 0.30, 0.95), 0.10, 0.20, "siren_blue"),
    # horses, tack and wagons (Redrock); the coat is `paint`
    "hair":         ((0.055, 0.045, 0.04), 0.00, 0.85, "fixed"),
    "hoof":         ((0.15, 0.13, 0.11), 0.00, 0.70, "fixed"),
    "eye":          ((0.02, 0.02, 0.02), 0.20, 0.15, "fixed"),
    "leather":      ((0.40, 0.24, 0.12), 0.00, 0.60, "fixed"),
    "leather_dark": ((0.21, 0.13, 0.08), 0.00, 0.60, "fixed"),
    "leather_black": ((0.07, 0.06, 0.055), 0.00, 0.55, "fixed"),
    "blanket_red":  ((0.56, 0.17, 0.10), 0.00, 0.95, "fixed"),
    "blanket_blue": ((0.14, 0.19, 0.34), 0.00, 0.95, "fixed"),
    "blanket_grey": ((0.45, 0.41, 0.35), 0.00, 0.95, "fixed"),
    "blanket_stripe": ((0.82, 0.50, 0.14), 0.00, 0.95, "fixed"),
    "rope":         ((0.66, 0.56, 0.38), 0.00, 0.90, "fixed"),
    "wood":         ((0.47, 0.33, 0.20), 0.00, 0.80, "fixed"),
    "wood_dark":    ((0.27, 0.18, 0.11), 0.00, 0.75, "fixed"),
    "wood_grey":    ((0.52, 0.47, 0.40), 0.00, 0.90, "fixed"),
    "iron":         ((0.13, 0.13, 0.14), 0.60, 0.55, "fixed"),
    "brass":        ((0.72, 0.56, 0.24), 0.90, 0.30, "fixed"),
    "canvas_white": ((0.87, 0.83, 0.73), 0.00, 0.95, "fixed"),
    "coach_red":    ((0.50, 0.10, 0.07), 0.10, 0.45, "fixed"),
    "coach_yellow": ((0.80, 0.58, 0.17), 0.10, 0.50, "fixed"),
    "lacquer":      ((0.035, 0.035, 0.04), 0.20, 0.30, "fixed"),
    "army_blue":    ((0.17, 0.21, 0.31), 0.10, 0.70, "fixed"),
    # casino and card-room furniture (furniture.py): the client prints each game's layout on
    # `felt`, shows the reels on `screen` and lights `sign`
    "felt":         ((0.10, 0.40, 0.23), 0.00, 0.95, "felt"),
    "green":        ((0.07, 0.45, 0.20), 0.10, 0.40, "fixed"),
    "screen":       ((0.92, 0.92, 0.88), 0.10, 0.20, "screen"),
    "sign":         ((0.98, 0.78, 0.25), 0.10, 0.30, "sign"),
    # weapons (names match the client's looks in render/weaponMesh.ts)
    "w_steel":    ((0.44, 0.46, 0.48), 0.80, 0.38, "steel"),
    "w_black":    ((0.12, 0.125, 0.135), 0.50, 0.50, "black"),
    "w_polymer":  ((0.17, 0.175, 0.19), 0.05, 0.75, "polymer"),
    "w_wood":     ((0.48, 0.29, 0.15), 0.00, 0.60, "wood"),
    "w_chrome":   ((0.83, 0.85, 0.86), 1.00, 0.15, "chrome"),
    "w_olive":    ((0.31, 0.35, 0.21), 0.10, 0.70, "olive"),
    "w_brass":    ((0.69, 0.55, 0.24), 0.90, 0.30, "brass"),
    "w_red":      ((0.64, 0.15, 0.12), 0.30, 0.45, "red"),
    "w_glass":    ((0.25, 0.42, 0.23), 0.10, 0.10, "glass"),
    "w_cloth":    ((0.85, 0.82, 0.75), 0.00, 0.95, "cloth"),
}


def lin(c):
    return tuple(x ** 2.2 for x in c)


def get(name):
    """The material by name, (re)set from the palette so edits here show on the next build."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    col, metal, rough, role = PALETTE[name]
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = lin(col) + (1.0,)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = lin(col) + (1.0,)
    m.metallic, m.roughness = metal, rough
    m["role"] = role
    return m


def role(m):
    return PALETTE[m.name][3] if m and m.name in PALETTE else "fixed"


def colour(m):
    return PALETTE[m.name][0] if m and m.name in PALETTE else (1, 0, 1)
