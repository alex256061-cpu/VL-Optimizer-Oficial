import dnfile

path = r"C:\Program Files (x86)\Steam\steamapps\common\Lossless Scaling\LosslessScaling.dll"
pe = dnfile.dnPE(path)
md = pe.net.mdtables

props = list(md.Property)
print("total properties:", len(props))

maps = []
for pm in md.PropertyMap:
    t = md.TypeDef.rows[pm.Parent.row_index - 1]
    idxs = [x.row_index for x in pm.PropertyList] if isinstance(pm.PropertyList, list) else []
    start = min(idxs) if idxs else 0
    maps.append((start, str(t.TypeName), str(t.TypeNamespace), t.row_index))
maps.sort()

for i, (start, name, ns, rid) in enumerate(maps):
    end = maps[i + 1][0] if i + 1 < len(maps) else len(props) + 1
    names = [str(props[r - 1].Name) for r in range(start, end) if 0 < r <= len(props)]
    if "Settings" in name or "Profile" in name:
        print(f"\n{ns}.{name}: {names}")

print("\n=== enums candidatos ===")
for t in md.TypeDef:
    name = str(t.TypeName)
    fields = [str(f.Name) for f in t.FieldList]
    if fields and fields[0] == "value__" and len(fields) <= 30:
        if any(k in name for k in ("Scaling", "Frame", "Capture", "Sync", "Gsync", "Mode", "Type", "Flow", "Api", "Theme", "Language")):
            print(f"{name}: {fields[1:]}")
