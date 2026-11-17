# ══════════════════════════════════════════════════════════════════════════
# drs.ps1 — o bloco DRS_PS do GDZ Optimizer (NVAPI / Driver Settings da NVIDIA).
#
# Fonte: RESTORE_PS/DRS_PS em C:\VLTemp\TIME\t8-templates.md (seção DRS_PS).
# Copiado literalmente do GDZ. Nada foi reescrito.
#
# Fica em arquivo separado (e não dentro do restore.ps1) pelo mesmo motivo do
# snapshot.ps1: são 60+ linhas de C# com cifrões, chaves e apas que não podem
# se misturar com o template do JavaScript. Separado, cada arquivo é válido
# sozinho e o parser do PowerShell confere os dois.
#
# Só é concatenado na frente do restore.ps1 quando a lista tem item t='drs' —
# é o withDrs() do GDZ. Sem item drs, a nvapi64.dll nem é carregada.
#
# Expõe: GdzDrsInit() -> bool, e [GDZ.Drs]::Set(id, valor) / [GDZ.Drs]::Del(id)
# ══════════════════════════════════════════════════════════════════════════
$gdzDrsSrc = @'
using System;
using System.Runtime.InteropServices;
namespace GDZ {
public static class Drs {
  [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
  static extern IntPtr Q(uint id);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int F0();
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FOut(out IntPtr h);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FS(IntPtr s);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FProf(IntPtr s, out IntPtr p);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FGet(IntPtr s, IntPtr p, uint id, IntPtr st);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FSet(IntPtr s, IntPtr p, IntPtr st);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FDel(IntPtr s, IntPtr p, uint id);
  static T D<T>(uint id) where T : class {
    IntPtr f = Q(id);
    if (f == IntPtr.Zero) throw new Exception("nvapi " + id.ToString("X8"));
    return (T)(object)Marshal.GetDelegateForFunctionPointer(f, typeof(T));
  }
  static void Ok(int r, string w) { if (r != 0) throw new Exception(w + " " + r); }
  // NVDRS_SETTING (versão 1): nome em 4, id em 4100, tipo em 4104, "é o valor de fábrica" em
  // 4112 e o valor atual em 8220.
  const int SZ = 12320;
  const int NOT_FOUND = -160;
  static IntPtr s, p;
  static IntPtr Buf() {
    IntPtr b = Marshal.AllocHGlobal(SZ);
    for (int i = 0; i < SZ; i += 4) Marshal.WriteInt32(b, i, 0);
    Marshal.WriteInt32(b, 0, 0x10000 | SZ);
    return b;
  }
  public static void Open() {
    Ok(D<F0>(0x0150E828)(), "init");
    Ok(D<FOut>(0x0694D52E)(out s), "session");
    Ok(D<FS>(0x375DBD6B)(s), "load");
    Ok(D<FProf>(0xDA8466A0)(s, out p), "profile");
  }
  public static string Get(uint id) {
    IntPtr b = Buf();
    try {
      int r = D<FGet>(0x73BF8338)(s, p, id, b);
      if (r == NOT_FOUND) return "";
      Ok(r, "get");
      if (Marshal.ReadInt32(b, 4104) != 0) throw new Exception("type");
      return Marshal.ReadInt32(b, 4112) != 0 ? "" : ((uint)Marshal.ReadInt32(b, 8220)).ToString();
    } finally { Marshal.FreeHGlobal(b); }
  }
  public static void Set(uint id, uint v) {
    IntPtr b = Buf();
    try {
      Marshal.WriteInt32(b, 4100, unchecked((int)id));
      Marshal.WriteInt32(b, 8220, unchecked((int)v));
      Ok(D<FSet>(0x577DD202)(s, p, b), "set");
      Ok(D<FS>(0xFCBC7E14)(s), "save");
    } finally { Marshal.FreeHGlobal(b); }
  }
  public static void Del(uint id) {
    int r = D<FDel>(0xE4A26362)(s, p, id);
    if (r != 0 && r != NOT_FOUND) throw new Exception("del " + r);
    Ok(D<FS>(0xFCBC7E14)(s), "save");
  }
}}
'@
$script:gdzDrsOn = $false
function GdzDrsInit {
  if ($script:gdzDrsOn) { return $true }
  try {
    if (-not ('GDZ.Drs' -as [type])) { Add-Type -TypeDefinition $gdzDrsSrc -ErrorAction Stop }
    [GDZ.Drs]::Open()
    $script:gdzDrsOn = $true
  } catch { return $false }
  return $true
}
function GdzDrsGet($id) { if (GdzDrsInit) { try { return [GDZ.Drs]::Get([uint32]$id) } catch {} }; return $null }
