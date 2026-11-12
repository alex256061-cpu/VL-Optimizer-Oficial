import dnfile, sys

path = r"C:\Program Files (x86)\Steam\steamapps\common\Lossless Scaling\LosslessScaling.dll"
pe = dnfile.dnPE(path)
md = pe.net.mdtables

def row_name(rid, table):
    try:
        return str(md.__getattribute__(table).rows[rid - 1].Name)
    except Exception:
        return None

# mapa TypeDef -> lista de Property
prop_by_type = {}
for pm in md.PropertyMap:
    t = md.TypeDef.rows[pm.Parent.row_index - 1]
    props = []
    for rid in range(pm.First.row_index, pm.First.row_index + pm.Properties.row_count if False else 0):
        pass
    prop_by_type[t.row_index] = pm

print("=== TIPOS com Settings/Profile ===")
for t in md.TypeDef:
    name = str(t.TypeName)
    ns = str(t.TypeNamespace)
    if ("Settings" in name) or ("Profile" in name) or ("GameProfile" in name):
        fields = [str(f.Name) for f in t.FieldList]
        print(f"\n{ns}.{name}")
        print("  fields:", [f for f in fields][:40])

print("\n=== PROPRIEDADES (por tipo) ===")
# PropertyMap -> PropertyList
for pm in md.PropertyMap:
    t = md.TypeDef.rows[pm.Parent.row_index - 1]
    tname = str(t.TypeName)
    if "Settings" not in tname and "Profile" not in tname:
        continue
    rids = [p.row_index for p in pm.PropertyList]
    names = []
    for r in rids:
        try:
            names.append(str(md.Property.rows[r].Name))
        except Exception:
            pass
    print(f"{tname}: {names}")

print("\n=== ENUMS (com valores) ===")
for t in md.TypeDef:
    name = str(t.TypeName)
    if not (t.Flags & 0x100):  # enum flag? actually flags != reliable; filter by base type name
        pass
    fields = [str(f.Name) for f in t.FieldList]
    vals = [f for f in fields if not str(t.FieldList[0].Name).startswith("value__")] if fields else []
    if any(k in name for k in ("ScalingType", "FrameGeneration", "CaptureApi", "SyncMode", "Gsync", "Mode", "Flow", "Type")) and len(fields) <= 25:
        print(f"{name}: {fields}")
