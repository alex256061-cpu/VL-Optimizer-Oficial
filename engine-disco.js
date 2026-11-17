// engine-disco.js — o motor de limpeza de disco do GDZ (classe C# GDZ.Disk).
//
// O GDZ não apaga arquivo com fs.rmSync do Node. Ele monta um script PowerShell que
// carrega uma CLASSE C# própria, compilada na primeira vez (Add-Type) e reaproveitada
// nas seguintes por um arquivo versionado pelo SHA-1 no userData. É essa classe que
// percorre as pastas, mede e apaga, e é ela que implementa as travas: arquivo em uso
// fica, reparse point nunca é seguido nem apagado, arquivo de nuvem (só ponteiro) é
// ignorado, ReadOnly é removido antes de apagar, pasta que fica vazia sai.
//
// Está num arquivo separado de propósito, igual ao foto-sistema.js: o C# embutido tem
// chaves e cifrão que brigam com template literal de JS, e aqui cada lado é validado
// com a sua própria ferramenta.
//
// O código C# é o do GDZ, sem reescrita: as mesmas 5 rotinas (Measure, MeasureTop,
// Clean, CleanTop, Scan), as mesmas constantes e os mesmos limites.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// A classe. Cópia fiel de DISK_CS (gdz-SEM-MANGLE.js, linha 4725).
const DISK_CS = String.raw`
using System;
using System.Collections.Generic;
using System.IO;
namespace GDZ {
public static class Disk {
  const int CLOUD = 0x400000 | 0x40000 | 0x1000;
  static bool IsLink(FileSystemInfo i) { return (i.Attributes & FileAttributes.ReparsePoint) != 0; }
  static bool IsCloud(FileSystemInfo i) { return ((int)i.Attributes & CLOUD) != 0; }

  // [bytes, arquivos] do que há dentro de path (ou do próprio arquivo), modificado há mais de minAgeDays dias.
  public static long[] Measure(string path, double minAgeDays) {
    long[] r = new long[2];
    DateTime cut = DateTime.UtcNow.AddDays(-minAgeDays);
    try {
      if (File.Exists(path)) {
        FileInfo f = new FileInfo(path);
        if (!IsLink(f) && f.LastWriteTimeUtc <= cut) { r[0] = f.Length; r[1] = 1; }
        return r;
      }
      if (!Directory.Exists(path)) return r;
    } catch { return r; }
    Sum(new DirectoryInfo(path), cut, r);
    return r;
  }
  static void Sum(DirectoryInfo root, DateTime cut, long[] r) {
    Stack<DirectoryInfo> stack = new Stack<DirectoryInfo>();
    stack.Push(root);
    while (stack.Count > 0) {
      DirectoryInfo d = stack.Pop();
      try {
        foreach (FileSystemInfo i in d.EnumerateFileSystemInfos()) {
          if (IsLink(i)) continue;
          DirectoryInfo sub = i as DirectoryInfo;
          if (sub != null) { stack.Push(sub); continue; }
          if (IsCloud(i) || i.LastWriteTimeUtc > cut) continue;
          r[0] += ((FileInfo)i).Length; r[1]++;
        }
      } catch { }
    }
  }

  // Pasta de temporários: a idade vale para cada item de primeiro nível. Pasta antiga sai inteira e
  // pasta recente fica inteira; assim um app que roda há dias não perde arquivos de dentro da pasta
  // dele (é a mesma regra do "Limpar arquivos temporários" de antes).
  public static long[] MeasureTop(string path, double minAgeDays) {
    long[] r = new long[2];
    DateTime cut = DateTime.UtcNow.AddDays(-minAgeDays);
    try {
      foreach (FileSystemInfo i in new DirectoryInfo(path).EnumerateFileSystemInfos()) {
        if (IsLink(i) || i.LastWriteTimeUtc > cut) continue;
        DirectoryInfo sub = i as DirectoryInfo;
        if (sub != null) Sum(sub, DateTime.MaxValue, r);
        else if (!IsCloud(i)) { r[0] += ((FileInfo)i).Length; r[1]++; }
      }
    } catch { }
    return r;
  }
  public static long[] CleanTop(string path, double minAgeDays) {
    long[] r = new long[3];
    DateTime cut = DateTime.UtcNow.AddDays(-minAgeDays);
    List<FileSystemInfo> items;
    try { items = new List<FileSystemInfo>(new DirectoryInfo(path).EnumerateFileSystemInfos()); } catch { return r; }
    foreach (FileSystemInfo i in items) {
      if (IsLink(i) || i.LastWriteTimeUtc > cut) continue;
      DirectoryInfo sub = i as DirectoryInfo;
      if (sub == null) { DelFile((FileInfo)i, DateTime.MaxValue, r); continue; }
      if (CleanDir(sub, DateTime.MaxValue, r, 1)) { try { sub.Delete(false); } catch { } }
    }
    return r;
  }

  // Apaga o que há dentro de path (ou o próprio arquivo) modificado há mais de minAgeDays dias. Arquivo em
  // uso fica; pasta que fica vazia sai, menos a própria path. Volta [bytes, arquivos, falhas].
  public static long[] Clean(string path, double minAgeDays) {
    long[] r = new long[3];
    DateTime cut = DateTime.UtcNow.AddDays(-minAgeDays);
    try {
      if (File.Exists(path)) { DelFile(new FileInfo(path), cut, r); return r; }
      if (!Directory.Exists(path)) return r;
    } catch { return r; }
    CleanDir(new DirectoryInfo(path), cut, r, 0);
    return r;
  }
  static bool DelFile(FileInfo f, DateTime cut, long[] r) {
    if (IsLink(f) || f.LastWriteTimeUtc > cut) return false;
    long len = f.Length;
    try {
      if ((f.Attributes & FileAttributes.ReadOnly) != 0) f.Attributes = f.Attributes & ~FileAttributes.ReadOnly;
      f.Delete();
      r[0] += len; r[1]++;
      return true;
    } catch { r[2]++; return false; }
  }
  static bool CleanDir(DirectoryInfo d, DateTime cut, long[] r, int depth) {
    List<FileSystemInfo> items;
    try { items = new List<FileSystemInfo>(d.EnumerateFileSystemInfos()); } catch { return false; }
    bool empty = true;
    foreach (FileSystemInfo i in items) {
      if (IsLink(i)) { empty = false; continue; }
      DirectoryInfo sub = i as DirectoryInfo;
      if (sub == null) { if (!DelFile((FileInfo)i, cut, r)) empty = false; continue; }
      bool old = sub.LastWriteTimeUtc <= cut; // data de antes da limpeza (apagar dentro muda a data)
      if (depth < 100 && CleanDir(sub, cut, r, depth + 1) && old) {
        try { sub.Delete(false); } catch { empty = false; }
      } else empty = false;
    }
    return empty;
  }

  // Lê o disco inteiro e escreve no stdout, uma linha por item (separado por TAB):
  //   P  arquivos bytes                        progresso, a cada 250 ms
  //   D  id pai total arquivos soltos nome     pastas com pelo menos 1/20000 do total (até 30 mil)
  //   F  bytes caminho                         os maiores arquivos
  // O pai de uma pasta sempre tem id menor que o dela, e uma pasta listada sempre tem o pai listado.
  public static void Scan(string root, int topFiles) {
    TextWriter o = Console.Out;
    List<int> parent = new List<int>(); List<string> name = new List<string>();
    List<long> own = new List<long>(); List<long> cnt = new List<long>();
    List<long> bigLen = new List<long>(); List<string> bigPath = new List<string>();
    parent.Add(-1); name.Add(root); own.Add(0); cnt.Add(0);
    Stack<int> ids = new Stack<int>(); Stack<DirectoryInfo> dirs = new Stack<DirectoryInfo>();
    ids.Push(0); dirs.Push(new DirectoryInfo(root));
    long files = 0, bytes = 0, tick = 0;
    System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
    while (dirs.Count > 0) {
      int id = ids.Pop(); DirectoryInfo d = dirs.Pop();
      try {
        foreach (FileSystemInfo i in d.EnumerateFileSystemInfos()) {
          if (IsLink(i)) continue;
          DirectoryInfo sub = i as DirectoryInfo;
          if (sub != null) {
            ids.Push(parent.Count); dirs.Push(sub);
            parent.Add(id); name.Add(sub.Name); own.Add(0); cnt.Add(0);
            continue;
          }
          if (IsCloud(i)) continue;
          long len = ((FileInfo)i).Length;
          own[id] += len; cnt[id]++; files++; bytes += len;
          if (topFiles > 0 && (bigLen.Count < topFiles || len > bigLen[0])) {
            int at = bigLen.BinarySearch(len); if (at < 0) at = ~at;
            bigLen.Insert(at, len); bigPath.Insert(at, i.FullName);
            if (bigLen.Count > topFiles) { bigLen.RemoveAt(0); bigPath.RemoveAt(0); }
          }
        }
      } catch { }
      if (sw.ElapsedMilliseconds - tick >= 250) { tick = sw.ElapsedMilliseconds; o.WriteLine("P\t" + files + "\t" + bytes); o.Flush(); }
    }
    int n = parent.Count;
    long[] tot = new long[n]; long[] num = new long[n];
    for (int k = 0; k < n; k++) { tot[k] = own[k]; num[k] = cnt[k]; }
    for (int k = n - 1; k > 0; k--) { tot[parent[k]] += tot[k]; num[parent[k]] += num[k]; }
    long min = Math.Max(8L << 20, tot[0] / 20000);
    while (true) { int c = 0; for (int k = 0; k < n; k++) if (tot[k] >= min) c++; if (c <= 30000) break; min *= 2; }
    for (int k = 0; k < n; k++)
      if (k == 0 || tot[k] >= min) o.WriteLine("D\t" + k + "\t" + parent[k] + "\t" + tot[k] + "\t" + num[k] + "\t" + own[k] + "\t" + name[k]);
    for (int k = bigLen.Count - 1; k >= 0; k--) o.WriteLine("F\t" + bigLen[k] + "\t" + bigPath[k]);
    o.Flush();
  }
}
}
`;

// Nome do tipo como o PowerShell enxerga (namespace GDZ + classe Disk).
const TIPO = 'GDZ.Disk';

// Escreve o .cs na pasta de dados desta marca e devolve o trecho de PowerShell que
// compila e carrega a classe.
//
// Versionado pelo SHA-1 (10 caracteres) do próprio código: quando o C# muda, o nome
// muda e o DLL velho não é reaproveitado.
//
// Os três níveis de fallback são os do GDZ, na mesma ordem:
//   1. DLL já compilada -> Add-Type -LiteralPath
//   2. DLL não existe -> compila com -OutputAssembly (fica pronta para a próxima)
//   3. qualquer falha -> compila em memória a partir do .cs sem gravar DLL
function diskPS(dataDir) {
  const sha = crypto.createHash('sha1').update(DISK_CS).digest('hex').slice(0, 10);
  const dir = dataDir || process.env.LOPT_DATA_DIR || require('os').tmpdir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const cs = path.join(dir, 'vl-disk-' + sha + '.cs');
  const dll = path.join(dir, 'vl-disk-' + sha + '.dll');
  try { if (!fs.existsSync(cs)) fs.writeFileSync(cs, DISK_CS, 'utf8'); } catch (e) {}
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  return (
    "if (-not (" + q(TIPO) + " -as [type])) {\n" +
    '  $cs = ' + q(cs) + '; $dll = ' + q(dll) + '\n' +
    '  try {\n' +
    '    if (-not (Test-Path -LiteralPath $dll)) { Add-Type -TypeDefinition ([IO.File]::ReadAllText($cs)) -OutputAssembly $dll -ErrorAction Stop }\n' +
    '    if (-not (' + q(TIPO) + ' -as [type])) { Add-Type -LiteralPath $dll -ErrorAction Stop }\n' +
    '  } catch { if (-not (' + q(TIPO) + ' -as [type])) { Add-Type -TypeDefinition ([IO.File]::ReadAllText($cs)) -ErrorAction Stop } }\n' +
    '}\n'
  );
}

// Monta o script completo: o bloco que carrega a classe vem PRIMEIRO e FORA de qualquer
// try. O ps() do engine.js embrulha todo script num try{} e, dentro de um try de um
// .ps1, Add-Type -TypeDefinition falha com TypeDefinitionError sempre (ver o comentário
// de separaAddType em engine.js). Aqui a linha começa com "if", não com "Add-Type",
// então o separaAddType não a pega — por isso o bloco é colocado antes do corpo e
// fechado com um marcador que o engine não usa.
function comMotor(dataDir, corpo) {
  return diskPS(dataDir) + '\n' + corpo;
}

module.exports = { DISK_CS, TIPO, diskPS, comMotor };
