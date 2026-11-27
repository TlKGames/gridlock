"""Build GRIDLOCK's vehicle and weapon models in Blender from art/specs/*.json.

Live:     workbench blender_run T:/Dev/gridlock/art/build.py  [-- --set vehicles --only sedan,gt --export]
Headless: blender -b --factory-startup -P art/build.py -- --set vehicles --export

Sizes come from art/specs/game.json (written from the packs by scripts/model-specs.ts); looks come
from art/specs/vehicles.json and art/specs/weapons.json. Each model is one collection holding an
empty named after the game id, its static mesh, and any moving parts (rotor, tailrotor, turret,
leg_fl...) with their origins at their pivots. Export: src/client/models/<set>.glb (Draco-compressed;
the client imports them by URL, render/models.ts).

Other universes: `--universe redrock` reads art/specs/redrock/*.json and exports to
src/universes/redrock/models/<set>.glb; its collections are named `redrock:<set>`.
"""
import importlib
import json
import os
import sys

ART = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ART)
if ART in sys.path:
    sys.path.remove(ART)
sys.path.insert(0, ART)
# Other projects built in the same Blender leave modules with the same names (kit, materials...).
for _name, _mod in list(sys.modules.items()):
    _f = getattr(_mod, "__file__", None) or ""
    if os.path.exists(os.path.join(ART, _name + ".py")) and not os.path.abspath(_f).startswith(ART):
        del sys.modules[_name]

import bpy  # noqa: E402

import kit  # noqa: E402

GRID = {"vehicles": 14.0, "weapons": 1.6, "furniture": 4.5}
COLS = {"vehicles": 6, "weapons": 5, "furniture": 5}
# The universe being built (--universe); Bayhaven, the default, keeps the top-level specs and output.
UNIVERSE = "bayhaven"


def spec_dir():
    return os.path.join(ART, "specs") if UNIVERSE == "bayhaven" else os.path.join(ART, "specs", UNIVERSE)


def out_path(set_name):
    if UNIVERSE == "bayhaven":
        return os.path.join(ROOT, "src", "client", "models", set_name + ".glb")
    return os.path.join(ROOT, "src", "universes", UNIVERSE, "models", set_name + ".glb")


def set_coll(set_name):
    """A set's collection name: `vehicles` for Bayhaven, `redrock:vehicles` for another universe."""
    return set_name if UNIVERSE == "bayhaven" else "%s:%s" % (UNIVERSE, set_name)


def model_coll(set_name, mid):
    """A model's own collection (`vehicles:sedan`, `redrock:vehicles:mustang`)."""
    return "%s:%s" % (set_coll(set_name), mid)


def spec(name):
    with open(os.path.join(spec_dir(), name + ".json")) as f:
        return json.load(f)


def merged(base, over):
    out = dict(base)
    for k, v in over.items():
        out[k] = merged(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def assemble(set_name, mid, objs, slot):
    """Join a model's static parts, hang everything off an empty named `mid`, move it to its slot."""
    col = kit.coll(model_coll(set_name, mid), kit.coll(set_coll(set_name)))
    anim = [o for o in objs if o.get("anim")]
    static = [o for o in objs if not o.get("anim")]
    body = kit.join(mid + ".body", static, col)
    root = bpy.data.objects.new(mid, None)
    root.empty_display_size = 0.3
    col.objects.link(root)
    root["model"] = mid
    body.parent = root
    parts = [body]
    groups = {}
    for o in anim:
        # `part` keeps same-tagged pieces apart (a team's two horses each have a leg_fl).
        groups.setdefault(o.get("part", o["anim"]), []).append(o)
    for key, obs in groups.items():
        # Copy them out now: the join deletes these objects, and their properties with them.
        pivot = tuple(obs[0].get("pivot", (0, 0, 0)))
        tag = obs[0]["anim"]
        j = kit.join("%s.%s" % (mid, key), obs, col)
        kit.origin_to(j, pivot)
        j["anim"] = tag
        j.parent = root
        parts.append(j)
    cols = COLS[set_name]
    # Vehicles run from the origin toward +x; weapons sit in their own block to the left; furniture
    # in a block of its own behind the vehicles.
    x0 = 0.0 if set_name in ("vehicles", "furniture") else -12.0 - cols * GRID[set_name]
    y0 = 20.0 if set_name == "furniture" else 0.0
    root.location = (x0 + (slot % cols) * GRID[set_name], y0 - (slot // cols) * GRID[set_name] * (0.55 if set_name == "vehicles" else 0.5), 0)
    return root, kit.tris(parts)


def build_vehicles(only):
    game, looks = spec("game")["vehicles"], spec("vehicles")
    styles = looks["styles"]
    total = 0
    for slot, (vid, look) in enumerate(looks["vehicles"].items()):
        if only and vid not in only:
            continue
        st = merged(styles[look["style"]], look.get("over", {})) if "style" in look else look
        # Trucks: the cab is a car style. Teams and buggies: the horse in harness is a horse style.
        # A monster truck's shell is a car style.
        for sub in ("cab", "horse", "shell"):
            if isinstance(st.get(sub), dict) and "style" in st[sub]:
                st[sub] = merged(styles[st[sub]["style"]], st[sub])
        kind = st.get("kind", "car")
        dims = game[vid] if vid in game else game[look["dims"]]["trailer"] if "dims" in look else None
        mod = importlib.import_module(kind)
        col = kit.coll(model_coll("vehicles", vid), kit.coll(set_coll("vehicles")))
        objs = mod.build(vid, st, dims, col)
        _, n = assemble("vehicles", vid, objs, slot)
        total += n
        print("%-14s %6d tris" % (vid, n))
    print("vehicles: %d tris in all" % total)


def build_weapons(only):
    game, looks = spec("game")["weapons"], spec("weapons")
    import weapon
    total = 0
    for slot, (wid, look) in enumerate(looks["weapons"].items()):
        if only and wid not in only:
            continue
        col = kit.coll(model_coll("weapons", wid), kit.coll(set_coll("weapons")))
        objs = weapon.build(wid, look, game.get(wid), col)
        _, n = assemble("weapons", wid, objs, slot)
        total += n
        print("%-16s %6d tris" % (wid, n))
    print("weapons: %d tris in all" % total)


def build_furniture(only):
    """Casino and card-room furniture (furniture.py), the same in every universe."""
    import furniture
    total = 0
    for slot, fid in enumerate(furniture.MODELS):
        if only and fid not in only:
            continue
        col = kit.coll(model_coll("furniture", fid), kit.coll(set_coll("furniture")))
        _, n = assemble("furniture", fid, furniture.build(fid, col), slot)
        total += n
        print("%-16s %6d tris" % (fid, n))
    print("furniture: %d tris in all" % total)


def export(set_name):
    path = out_path(set_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = bpy.data.collections[set_coll(set_name)]
    sc = kit.scene()
    vl = sc.view_layers[0]
    for o in vl.objects:
        o.select_set(False, view_layer=vl)
    moved = []
    for o in c.all_objects:
        o.select_set(True, view_layer=vl)
        if o.get("model"):
            moved.append((o, tuple(o.location)))
            o.location = (0, 0, 0)  # every model at the origin in the file
    # Only this build's scene: headless its scene isn't the active one, and other scenes open in the
    # same Blender (other projects) must not leak in.
    with bpy.context.temp_override(scene=sc, view_layer=vl):
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
                                  export_yup=True, export_extras=True, export_lights=False, export_cameras=False,
                                  export_animations=False, export_texcoords=False, export_tangents=False,
                                  # Draco: about a sixth of the size over the wire (decoder ships with three).
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                                  export_draco_position_quantization=14, export_draco_normal_quantization=10)
    for o, loc in moved:
        o.location = loc
    print("exported %s (%d KB)" % (path, os.path.getsize(path) // 1024))


def main(argv):
    global UNIVERSE
    UNIVERSE = argv[argv.index("--universe") + 1] if "--universe" in argv else "bayhaven"
    sets = [argv[argv.index("--set") + 1]] if "--set" in argv else ["vehicles", "weapons"]
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    kit.scene()
    if only is None and "--set" not in argv:
        kit.reset()
    elif only is None:  # one whole set: leave the other alone
        for s in sets:
            c = bpy.data.collections.get(set_coll(s))
            if c:
                for sub in [c] + list(c.children_recursive):
                    for o in list(sub.objects):
                        bpy.data.objects.remove(o, do_unlink=True)
                for sub in list(c.children_recursive):
                    bpy.data.collections.remove(sub)
    else:
        for s in sets:  # rebuild just these models
            for mid in only:
                c = bpy.data.collections.get(model_coll(s, mid))
                if c:
                    for o in list(c.objects):
                        bpy.data.objects.remove(o, do_unlink=True)
                    bpy.data.collections.remove(c)
    for s in sets:
        {"vehicles": build_vehicles, "weapons": build_weapons, "furniture": build_furniture}[s](only)
        if "--export" in argv:
            export(s)


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
main(argv)
